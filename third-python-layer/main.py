import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import google.generativeai as genai
from elasticsearch import Elasticsearch
import PyPDF2
from pathlib import Path
import numpy as np
from dotenv import load_dotenv
import json
from typing import List, Dict
import re

# Load environment variables
load_dotenv()

# Initialize FastAPI app
app = FastAPI()

# Initialize Gemini
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
model = genai.GenerativeModel('gemini-pro')
embedding_model = genai.GenerativeModel('embedding-001')

# Initialize Elasticsearch
es = Elasticsearch(os.getenv("ELASTICSEARCH_URL", "http://localhost:9200"))

# Constants for chunking
CHUNK_SIZE = 1000  # characters
CHUNK_OVERLAP = 200  # characters
MIN_CHUNK_SIZE = 100  # Minimum characters for a chunk to be considered valid

# Create index if it doesn't exist
INDEX_NAME = "viral_videos_knowledge"
if not es.indices.exists(index=INDEX_NAME):
    es.indices.create(
        index=INDEX_NAME,
        body={
            "mappings": {
                "properties": {
                    "content": {"type": "text"},
                    "embedding": {"type": "dense_vector", "dims": 768},
                    "page_num": {"type": "integer"},
                    "chunk_num": {"type": "integer"}
                }
            }
        }
    )

def clean_text(text: str) -> str:
    """Clean and normalize text."""
    # Remove excessive whitespace
    text = re.sub(r'\s+', ' ', text)
    # Remove special characters but keep punctuation
    text = re.sub(r'[^\w\s.,!?;:-]', '', text)
    return text.strip()

def create_chunks(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """Create overlapping chunks from text."""
    cleaned_text = clean_text(text)
    chunks = []
    
    # Split text into sentences (rough approximation)
    sentences = re.split(r'(?<=[.!?])\s+', cleaned_text)
    current_chunk = []
    current_length = 0
    
    for sentence in sentences:
        sentence_length = len(sentence)
        
        # If adding this sentence would exceed chunk size
        if current_length + sentence_length > chunk_size and current_length >= MIN_CHUNK_SIZE:
            # Save current chunk
            chunks.append(' '.join(current_chunk))
            # Start new chunk with overlap
            overlap_point = max(0, len(current_chunk) - int(len(current_chunk) * (overlap / chunk_size)))
            current_chunk = current_chunk[overlap_point:]
            current_length = sum(len(s) for s in current_chunk)
        
        current_chunk.append(sentence)
        current_length += sentence_length
    
    # Add the last chunk if it's long enough
    if current_length >= MIN_CHUNK_SIZE:
        chunks.append(' '.join(current_chunk))
    
    return chunks

def process_pdf(pdf_path: str) -> List[Dict]:
    """Process PDF and extract text with page numbers and chunks."""
    documents = []
    with open(pdf_path, 'rb') as file:
        pdf_reader = PyPDF2.PdfReader(file)
        for page_num in range(len(pdf_reader.pages)):
            page = pdf_reader.pages[page_num]
            text = page.extract_text()
            
            if text.strip():  # Only process non-empty pages
                # Create chunks for this page
                chunks = create_chunks(text)
                
                # Create a document for each chunk
                for chunk_num, chunk in enumerate(chunks):
                    if len(chunk.strip()) >= MIN_CHUNK_SIZE:
                        documents.append({
                            "content": chunk,
                            "page_num": page_num + 1,
                            "chunk_num": chunk_num + 1,
                            "source": pdf_path,
                            "total_chunks": len(chunks)
                        })
    return documents

def get_embedding(text: str) -> List[float]:
    """Get embeddings using Gemini."""
    result = embedding_model.embed_content(text)
    return result.embedding

def index_documents():
    """Index all PDF documents in the pdfs directory."""
    pdf_dir = Path("pdfs")
    for pdf_path in pdf_dir.glob("*.pdf"):
        documents = process_pdf(str(pdf_path))
        for doc in documents:
            embedding = get_embedding(doc["content"])
            es.index(
                index=INDEX_NAME,
                document={
                    "content": doc["content"],
                    "embedding": embedding,
                    "page_num": doc["page_num"],
                    "chunk_num": doc["chunk_num"],
                    "source": doc["source"],
                    "total_chunks": doc["total_chunks"]
                }
            )
    es.indices.refresh(index=INDEX_NAME)

# Index documents on startup
index_documents()

class VideoQuery(BaseModel):
    video_info: Dict[str, str]  # timestamp -> information mapping

def format_timestamp_info(video_info: Dict[str, str]) -> str:
    """Format timestamp information into a structured query."""
    formatted_query = "Video Timeline Information:\n"
    # Sort timestamps to maintain chronological order
    sorted_timestamps = sorted(video_info.keys())
    for timestamp in sorted_timestamps:
        formatted_query += f"At {timestamp}: {video_info[timestamp]}\n"
    return formatted_query

def hybrid_search(query: str, k: int = 5):
    """Perform hybrid search using BM25 and vector similarity."""
    # Get query embedding
    query_embedding = get_embedding(query)
    
    # Hybrid search using both BM25 and vector similarity
    response = es.search(
        index=INDEX_NAME,
        body={
            "query": {
                "combined_fields": {
                    "query": query,
                    "fields": ["content"]
                }
            },
            "knn": {
                "field": "embedding",
                "query_vector": query_embedding,
                "k": k,
                "num_candidates": 100
            },
            "size": k
        }
    )
    
    return [hit["_source"] for hit in response["hits"]["hits"]]

@app.post("/get-viral-recommendations")
async def get_viral_recommendations(video: VideoQuery):
    try:
        # Format the timestamp information into a structured query
        query = format_timestamp_info(video.video_info)
        
        # Get relevant contexts using hybrid search
        relevant_contexts = hybrid_search(query)
        
        # Format the response
        formatted_contexts = []
        for ctx in relevant_contexts:
            formatted_contexts.append({
                "content": ctx["content"],
                "source": ctx["source"],
                "page_number": ctx["page_num"],
                "chunk_number": ctx["chunk_num"],
                "total_chunks": ctx["total_chunks"]
            })
        
        return {
            "status": "success",
            "recommendations": formatted_contexts,
            "query_used": query  # Include the formatted query for reference
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
