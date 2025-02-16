from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
from refiner import process_video
from create_video import generate_video
from captions import generate_subtitled_video
from voiceover import generate_voiceover

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
    
@app.post("/generate-captions")
async def generate_captions(filename: str):
    if not filename.lower().endswith('.mp4'):
        return {"error": "Only MP4 files are allowed"}
    
    file_path = os.path.join("raw", filename)
    try:
        output_path = generate_subtitled_video(file_path)
        return {
            "message": "Subtitled video created successfully",
            "original_file": filename,
            "processed_file": output_path
        }
    except Exception as e:
        return {"error": f"Error generating captions: {str(e)}"}
    
@app.post("/generate-voiceover")
async def generate_voiceover_endpoint(filename: str):
    """
    Endpoint to generate a voiceover for a video file.
    
    Parameters:
        filename (str): Name of the video file in the raw directory
    
    Returns:
        dict: Contains the path to the processed video file
    """
    try:
        input_path = os.path.join("raw", filename)
        if not os.path.exists(input_path):
            raise HTTPException(status_code=404, detail="Video file not found")
            
        processed_file = await generate_voiceover(input_path)
        
        return {
            "status": "success",
            "processed_file": processed_file
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
