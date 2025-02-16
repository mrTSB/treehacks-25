from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict
from utils import (
    setup_storage,
    index_documents,
    format_timestamp_info,
    hybrid_search,
    vectorize_pdfs
)

# Initialize FastAPI app
app = FastAPI(title="Video Virality RAG API")

# Setup storage and index documents on startup
@app.on_event("startup")
async def startup_event():
    setup_storage()
    index_documents()

@app.post("/vectorize")
async def force_vectorize():
    """Force re-vectorization of all PDFs."""
    try:
        result = vectorize_pdfs(force=True)
        return {"status": "success", "message": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class VideoQuery(BaseModel):
    video_info: Dict[str, str]  # timestamp -> information mapping

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