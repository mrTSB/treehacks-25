import os
from pathlib import Path
import PyPDF2
import re
from typing import List, Dict
import google.generativeai as genai
from elasticsearch import Elasticsearch
from dotenv import load_dotenv
import numpy as np
from functools import lru_cache
import pickle
import hashlib
from datetime import datetime
from sentence_transformers import SentenceTransformer

# Load environment variables
load_dotenv()

# Initialize models
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
generation_config = {
    "temperature": 0.7,
    "top_p": 1,
    "top_k": 1,
    "max_output_tokens": 2048,
}

generation_model = genai.GenerativeModel(model_name="models/gemini-pro",
                                       generation_config=generation_config)
# Initialize the sentence transformer model
embedding_model = SentenceTransformer('all-MiniLM-L6-v2')

# Constants for chunking
CHUNK_SIZE = 1000  # characters
CHUNK_OVERLAP = 200  # characters
MIN_CHUNK_SIZE = 100  # Minimum characters for a chunk to be considered valid
INDEX_NAME = "viral_videos_knowledge"
VECTORS_FILE = "pdf_vectors.pkl"
PDF_HASH_FILE = "pdf_hashes.pkl"
EMBEDDING_DIMENSION = 384  # MiniLM-L6-v2 embedding dimension

# In-memory storage as fallback
in_memory_docs = []
USE_ELASTICSEARCH = False

def get_pdf_hash(pdf_path: str) -> str:
    """Get hash of PDF file to detect changes."""
    with open(pdf_path, 'rb') as file:
        return hashlib.md5(file.read()).hexdigest()

def load_stored_vectors():
    """Load previously vectorized PDFs if they exist."""
    if os.path.exists(VECTORS_FILE) and os.path.exists(PDF_HASH_FILE):
        with open(VECTORS_FILE, 'rb') as f:
            stored_vectors = pickle.load(f)
        with open(PDF_HASH_FILE, 'rb') as f:
            stored_hashes = pickle.load(f)
        return stored_vectors, stored_hashes
    return [], {}

def save_vectors(vectors, hashes):
    """Save vectorized PDFs and their hashes."""
    with open(VECTORS_FILE, 'wb') as f:
        pickle.dump(vectors, f)
    with open(PDF_HASH_FILE, 'wb') as f:
        pickle.dump(hashes, f)

def cosine_similarity(a, b):
    """Compute cosine similarity between two vectors."""
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

def setup_storage():
    """Setup storage system (Elasticsearch if available, otherwise in-memory)."""
    global USE_ELASTICSEARCH, es, in_memory_docs
    try:
        es = Elasticsearch(os.getenv("ELASTICSEARCH_URL", "http://localhost:9200"))
        es.info()  # Test connection
        USE_ELASTICSEARCH = True
        
        if not es.indices.exists(index=INDEX_NAME):
            es.indices.create(
                index=INDEX_NAME,
                body={
                    "mappings": {
                        "properties": {
                            "content": {"type": "text"},
                            "embedding": {"type": "dense_vector", "dims": EMBEDDING_DIMENSION},
                            "page_num": {"type": "integer"},
                            "chunk_num": {"type": "integer"}
                        }
                    }
                }
            )
        print("Successfully connected to Elasticsearch")
    except Exception as e:
        print(f"Elasticsearch not available: {str(e)}")
        print("Using in-memory storage instead")
        USE_ELASTICSEARCH = False
        
        # Load stored vectors if available
        stored_docs, _ = load_stored_vectors()
        if stored_docs:
            in_memory_docs = stored_docs
            print(f"Loaded {len(stored_docs)} previously vectorized documents")

def vectorize_pdfs(force: bool = False) -> str:
    """Vectorize PDFs and store the results. Returns status message."""
    global in_memory_docs
    
    pdf_dir = Path("pdfs")
    if not pdf_dir.exists():
        return "No 'pdfs' directory found"
    
    pdfs = list(pdf_dir.glob("*.pdf"))
    if not pdfs:
        return "No PDFs found in the 'pdfs' directory"
    
    # Load existing vectors and hashes
    stored_vectors, stored_hashes = load_stored_vectors()
    current_hashes = {}
    needs_update = force  # True if force vectorization is requested
    
    # Check which PDFs need to be processed
    for pdf_path in pdfs:
        pdf_hash = get_pdf_hash(str(pdf_path))
        current_hashes[str(pdf_path)] = pdf_hash
        if pdf_hash != stored_hashes.get(str(pdf_path)):
            needs_update = True
    
    if not needs_update and stored_vectors:
        in_memory_docs = stored_vectors
        return "Using existing vectors - no changes detected in PDFs"
    
    # Process PDFs
    new_vectors = []
    for pdf_path in pdfs:
        print(f"Processing {pdf_path}")
        documents = process_pdf(str(pdf_path))
        for doc in documents:
            embedding = get_embedding(doc["content"])
            doc["embedding"] = embedding
            new_vectors.append(doc)
            
            if USE_ELASTICSEARCH:
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
    
    # Update storage
    if USE_ELASTICSEARCH:
        es.indices.refresh(index=INDEX_NAME)
    else:
        in_memory_docs = new_vectors
    
    # Save the new vectors and hashes
    save_vectors(new_vectors, current_hashes)
    
    return f"Successfully vectorized {len(pdfs)} PDFs with {len(new_vectors)} total chunks"

def clean_text(text: str) -> str:
    """Clean and normalize text."""
    text = re.sub(r'\s+', ' ', text)
    text = re.sub(r'[^\w\s.,!?;:-]', '', text)
    return text.strip()

def create_chunks(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """Create overlapping chunks from text."""
    cleaned_text = clean_text(text)
    chunks = []
    
    sentences = re.split(r'(?<=[.!?])\s+', cleaned_text)
    current_chunk = []
    current_length = 0
    
    for sentence in sentences:
        sentence_length = len(sentence)
        
        if current_length + sentence_length > chunk_size and current_length >= MIN_CHUNK_SIZE:
            chunks.append(' '.join(current_chunk))
            overlap_point = max(0, len(current_chunk) - int(len(current_chunk) * (overlap / chunk_size)))
            current_chunk = current_chunk[overlap_point:]
            current_length = sum(len(s) for s in current_chunk)
        
        current_chunk.append(sentence)
        current_length += sentence_length
    
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
            
            if text.strip():
                chunks = create_chunks(text)
                
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

@lru_cache(maxsize=1000)
def get_embedding(text: str) -> List[float]:
    """Get embeddings using sentence-transformers with caching."""
    try:
        # Encode the text and convert to list
        embedding = embedding_model.encode(text, convert_to_numpy=True).tolist()
        return embedding
    except Exception as e:
        print(f"Error getting embedding: {str(e)}")
        # Return a zero vector as fallback
        return [0.0] * EMBEDDING_DIMENSION

def index_documents():
    """Index all PDF documents in the pdfs directory."""
    return vectorize_pdfs(force=False)

def format_timestamp_info(video_info: Dict[str, str]) -> str:
    """Format timestamp information into a structured query."""
    formatted_query = "Video Timeline Information:\n"
    sorted_timestamps = sorted(video_info.keys())
    for timestamp in sorted_timestamps:
        formatted_query += f"At {timestamp}: {video_info[timestamp]}\n"
    return formatted_query

def hybrid_search(query: str, k: int = 5):
    """Perform hybrid search using BM25 and vector similarity or in-memory search."""
    query_embedding = get_embedding(query)
    
    if USE_ELASTICSEARCH:
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
    else:
        # In-memory search using cosine similarity
        similarities = []
        for doc in in_memory_docs:
            score = cosine_similarity(query_embedding, doc["embedding"])
            similarities.append((score, doc))
        
        # Sort by similarity score and return top k
        similarities.sort(key=lambda x: x[0], reverse=True)
        return [doc for score, doc in similarities[:k]] 