from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import os
from refiner import process_video
from create_video import generate_video

app = FastAPI()

# Update your allowed origins to include your development domain only
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://3.85.183.100:3000",  
        "http://localhost:3000"      # production frontend domain
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# Create directories if they don't exist
os.makedirs("raw", exist_ok=True)
os.makedirs("edited", exist_ok=True)

@app.post("/upload-video")
async def upload_video(filename: str):
    if not filename.lower().endswith('.mp4'):
        return {"error": "Only MP4 files are allowed"}
    
    file_path = os.path.join("raw", filename)
    
    # Check if file exists in raw directory
    if not os.path.exists(file_path):
        return {"error": "File not found in raw directory"}
    
    # Process the video
    try:
        process_video(file_path)
        output_path = os.path.join("edited", filename)
        
        return {
            "message": "Video processed successfully",
            "original_file": filename,
            "processed_file": output_path
        }
    except Exception as e:
        return {"error": f"Error processing video: {str(e)}"}

@app.post("/create-video")
async def create_video(filename: str):
    if not filename.lower().endswith('.mp4'):
        return {"error": "Only MP4 files are allowed"}
    
    file_path = os.path.join("raw", filename)
    
    # Check if file exists in raw directory
    if not os.path.exists(file_path):
        return {"error": "File not found in raw directory"}
    
    try:
        output_path = generate_video(file_path)
        return {
            "message": "Video created successfully",
            "original_file": filename,
            "processed_file": output_path
        }
    except Exception as e:
        return {"error": f"Error creating video: {str(e)}"}
