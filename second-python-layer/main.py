from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs
from openai import OpenAI
import whisper
from fastapi import FastAPI, Body, HTTPException
from fastapi.responses import FileResponse
from moviepy.editor import VideoFileClip, AudioFileClip
from pydub import AudioSegment
from clipsai import ClipFinder, Transcriber
from moviepy.video.io.ffmpeg_tools import ffmpeg_extract_subclip
from pydantic import BaseModel
import threading
import face_recognition
import cv2
from fastapi.middleware.cors import CORSMiddleware
import requests
from pathlib import Path
import time
import os
import subprocess
import uuid

app = FastAPI()

# Add CORS middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Load environment variables
load_dotenv()
elevenlabs_client = ElevenLabs(api_key=os.getenv("ELEVENLABS_API_KEY"))
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Load the Whisper model once to avoid reloading every request
model = whisper.load_model("base")

# Add after existing imports and before app initialization
class TaskResponse(BaseModel):
    task_id: str
    status: str
    result: dict = None

# Add after app initialization
task_store = {}
task_lock = threading.Lock()

def get_video_duration(video_path: str) -> float:
    """Extracts and returns the duration of the video in seconds using MoviePy."""
    video = VideoFileClip(video_path)
    return video.duration


def estimate_speech_duration(text: str, wpm: int = 178) -> float:
    """Estimates the duration of a given text when spoken."""
    word_count = len(text.split())
    return (word_count / wpm) * 60  # duration in seconds


def change_audio_speed(audio_path: str, target_duration: float) -> str:
    """Changes the speed of the audio file to match the target duration using pydub."""
    audio = AudioSegment.from_file(audio_path)
    current_duration = len(audio) / 1000  # Convert ms to seconds
    speed_change = current_duration / target_duration

    # Adjust speed
    new_audio = audio._spawn(audio.raw_data, overrides={
        "frame_rate": int(audio.frame_rate * speed_change)
    }).set_frame_rate(audio.frame_rate)

    output_path = audio_path.replace(".mp3", "_adjusted.mp3")
    new_audio.export(output_path, format="mp3")
    return output_path


def merge_audio_with_video(video_path: str, audio_path: str, output_path: str):
    """Merges generated voiceover with the original video."""
    video = VideoFileClip(video_path)
    audio = AudioFileClip(audio_path)
    video = video.set_audio(audio)
    video.write_videofile(output_path, codec='libx264', audio_codec='aac')


def elevenlabs_voiceover(text: str, video_duration: float, voice_id: str = "JBFqnCBsd6RMkjVDRZzb") -> str:
    """Generates voiceover using ElevenLabs API and adjusts speed to match video duration."""
    audio_stream = elevenlabs_client.text_to_speech.convert_as_stream(
        text=text,
        voice_id=voice_id,
        model_id="eleven_multilingual_v2"
    )

    audio_chunks = [chunk for chunk in audio_stream if isinstance(chunk, bytes)]
    complete_audio = b''.join(audio_chunks)

    audio_path = f"voiceover_{uuid.uuid4().hex[:8]}.mp3"
    with open(audio_path, "wb") as f:
        f.write(complete_audio)

    # Adjust the audio duration to match the video duration
    adjusted_audio_path = change_audio_speed(audio_path, video_duration)

    return adjusted_audio_path


def generate_transcript(prompt: str) -> str:
    """Generates transcript using OpenAI API."""
    response = openai_client.chat.completions.create(
        model="gpt-4-turbo-preview",
        messages=[{"role": "user", "content": f"Generate a transcript for the following prompt: {prompt}"}]
    )
    return response.choices[0].message.content

def srt_timestamp_to_seconds(timestamp: str) -> float:
    """
    Converts an SRT timestamp (e.g., "00:00:12,500") to seconds as a float.
    """
    try:
        hours, minutes, sec_milli = timestamp.split(":")
        seconds, milliseconds = sec_milli.split(",")
        total_seconds = int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(milliseconds) / 1000.0
        return total_seconds
    except Exception:
        return 0.0

@app.post("/generate_sound_effects_video")
def generate_sound_effects_video(
    video_path: str = Body(..., embed=True),
    srt_path: str = Body(..., embed=True)
) -> dict:
    """
    Adds sound effects to the provided video based on cues found in the SRT file.
    
    The function:
      - Reads the SRT file and looks for keywords in each subtitle.
      - When a keyword is found (e.g., "meme", "explosion", "serious", "emotional"),
        the corresponding local sound effect file is selected.
      - It then uses ffmpeg to overlay these sound effect audio tracks (delayed to the proper timestamp)
        on top of the original audio track.
    
    Expected request body example:
    {
        "video_path": "/path/to/video.mp4",
        "srt_path": "/path/to/subtitles.srt"
    }
    """
    # Check if the provided video and SRT files exist
    if not os.path.isfile(video_path):
        return {"error": f"Video file {video_path} does not exist."}
    if not os.path.isfile(srt_path):
        return {"error": f"SRT file {srt_path} does not exist."}

    # Define a mapping from keywords to local sound effect files.
    # You can adjust the keywords and file paths as needed.
    effects_mapping = {
        ("meme", "funny"): "sounds/baby-laughing-meme.mp3",
        ("explosion", "boom", "kaboom"): "sounds/shocked-sound-effect.mp3",
        ("serious",): "sounds/y2mate_5gbydy1",
        ("emotional", "sad", "cry", "tears"): "sounds/emotional-damage-meme.mp3"
    }

    # Parse the SRT file to extract segments.
    # Each segment is assumed to be separated by a blank line.
    events = []  # List of tuples: (start_time_in_seconds, effect_file)
    with open(srt_path, "r", encoding="utf-8") as f:
        content = f.read().strip()

    segments = content.split("\n\n")
    for segment in segments:
        lines = segment.splitlines()
        if len(lines) >= 3:
            # The second line should have the timestamp: "00:00:12,500 --> 00:00:15,000"
            timestamp_line = lines[1]
            start_str, _, _ = timestamp_line.partition(" --> ")
            start_time = srt_timestamp_to_seconds(start_str)
            # Combine the text lines and convert to lower case for matching
            text = " ".join(lines[2:]).lower()
            # Check for each set of keywords if any are in the subtitle text
            for keywords, effect_file in effects_mapping.items():
                if any(keyword in text for keyword in keywords):
                    if os.path.isfile(effect_file):
                        events.append((start_time, effect_file))
                    break  # Only add one effect per segment

    if not events:
        return {"message": "No relevant sound effects found in the SRT."}

    # Build the ffmpeg command
    output_video_filename = f"sound_effects_{uuid.uuid4().hex[:8]}.mp4"
    cmd = ["ffmpeg", "-y", "-i", video_path]
    
    # Append each sound effect file as an additional input.
    for event in events:
        effect_file = event[1]
        cmd.extend(["-i", effect_file])
    
    # Build the filter_complex string.
    # For each sound effect input, delay it by the start time (in milliseconds).
    filter_parts = []
    for i, event in enumerate(events):
        start_time = event[0]
        delay_ms = int(start_time * 1000)
        # For stereo audio, specify the delay for both channels (e.g., "1500|1500")
        filter_parts.append(f"[{i+1}:a]adelay={delay_ms}|{delay_ms}[se{i+1}]")
    
    # Combine the original audio [0:a] with all the delayed sound effects.
    # The number of inputs is 1 (the original audio) + number of sound effects.
    inputs_for_amix = "[0:a]" + "".join(f"[se{i+1}]" for i in range(len(events)))
    amix_filter = f"{inputs_for_amix}amix=inputs={len(events)+1}:duration=first:dropout_transition=3[outa]"
    
    # Concatenate all filter parts using a semicolon separator.
    filter_complex = "; ".join(filter_parts + [amix_filter])
    cmd.extend([
        "-filter_complex", filter_complex,
        "-map", "0:v",       # Map the original video stream
        "-map", "[outa]",    # Map the new mixed audio stream
        "-c:v", "copy",      # Copy the video stream without re-encoding
        "-c:a", "aac",       # Encode the audio to AAC
        output_video_filename
    ])

    try:
        subprocess.run(cmd, check=True)
        return {"message": "Sound effects added to video.", "output_video": output_video_filename}
    except subprocess.CalledProcessError as e:
        return {"error": f"Failed to add sound effects: {str(e)}"}

@app.post("/generate_subtitled_video")
def generate_subtitled_video(video_path: str = Body(..., embed=True)) -> dict:
    """
    Takes a local path to a video file, generates subtitles using Whisper,
    and returns a path to the newly created video with burned-in subtitles.
    """
    if not os.path.isfile(video_path):
        return {"error": f"File {video_path} does not exist."}

    result = model.transcribe(video_path)
    segments = result["segments"]

    unique_prefix = str(uuid.uuid4())[:8]
    output_video_filename = f"subtitled_{unique_prefix}.mp4"
    srt_filename = output_video_filename.replace('.mp4', '.srt')  # Keep same base path as video

    with open(srt_filename, "w", encoding="utf-8") as f:
        for i, segment in enumerate(segments):
            start = seconds_to_srt_timestamp(segment["start"])
            end = seconds_to_srt_timestamp(segment["end"])
            text = segment["text"].strip()
            f.write(f"{i+1}\n{start} --> {end}\n{text}\n\n")

    cmd = ["ffmpeg", "-y", "-i", video_path, "-vf", f"subtitles={srt_filename}", output_video_filename]
    subprocess.run(cmd, check=True)

    # Don't remove the SRT file anymore since we need it for sound effects
    return {"message": "Subtitled video created.", "output_video": output_video_filename}


@app.post("/generate_voiceover")
def generate_voiceover_endpoint(
    video_path: str = Body(..., embed=True),
    prompt: str = Body(..., embed=True),
    voice_id: str = Body("JBFqnCBsd6RMkjVDRZzb", embed=True)
) -> dict:
    """
    Generates a voiceover from a text prompt using OpenAI for transcript generation,
    and ElevenLabs for text-to-speech, ensuring it fits the video length.

    Request body example:
    {
        "video_path": "/path/to/video.mp4",
        "prompt": "Write a story about a cat that can fly",
        "voice_id": "JBFqnCBsd6RMkjVDRZzb"  # Optional
    }
    """
    try:
        if not os.path.isfile(video_path):
            return {"error": f"File {video_path} does not exist."}

        video_duration = get_video_duration(video_path)
        transcript = generate_transcript(prompt)
        adjusted_audio_path = elevenlabs_voiceover(transcript, video_duration, voice_id)

        output_video_filename = f"final_{uuid.uuid4().hex[:8]}.mp4"
        merge_audio_with_video(video_path, adjusted_audio_path, output_video_filename)

        return {
            "message": "Voiceover generated and merged successfully",
            "transcript": transcript,
            "audio_path": adjusted_audio_path,
            "output_video": output_video_filename
        }
    except Exception as e:
        return {"error": f"Failed to generate voiceover: {str(e)}"}


@app.get("/download_voiceover")
def download_voiceover(file_path: str):
    """Download the generated voiceover file."""
    if not os.path.isfile(file_path):
        return {"error": "Audio file does not exist"}
    return FileResponse(path=file_path, media_type="audio/mpeg", filename=os.path.basename(file_path))


@app.get("/download_video")
def download_video(file_path: str):
    """Download the final video with subtitles and voiceover."""
    if not os.path.isfile(file_path):
        return {"error": "File does not exist."}
    return FileResponse(path=file_path, media_type="video/mp4", filename=os.path.basename(file_path))


# Add these new functions after the existing helper functions
def generate_clip(video_file_path: str, clip, idx: int, video_uuid: str) -> str:
    """Generate a clip from the video file."""
    clip_file_path = f"./{video_uuid}_clip_{idx}.mp4"
    ffmpeg_extract_subclip(
        video_file_path, 
        clip.start_time, 
        clip.end_time, 
        targetname=clip_file_path
    )
    return clip_file_path

def custom_resize(video_file_path: str, aspect_ratio=(9, 16)) -> dict:
    """Custom resize function using face-recognition"""
    video = cv2.VideoCapture(video_file_path)
    
    # Get video properties
    width = int(video.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(video.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    # Calculate target dimensions
    target_ratio = aspect_ratio[0] / aspect_ratio[1]
    current_ratio = width / height
    
    if current_ratio > target_ratio:
        # Video is too wide
        new_width = int(height * target_ratio)
        crop_width = new_width
        crop_height = height
        x_offset = (width - new_width) // 2
        y_offset = 0
    else:
        # Video is too tall
        new_height = int(width / target_ratio)
        crop_width = width
        crop_height = new_height
        x_offset = 0
        y_offset = (height - new_height) // 2
    
    # Find face location in first frame
    ret, frame = video.read()
    if ret:
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        face_locations = face_recognition.face_locations(rgb_frame)
        
        if face_locations:
            # Use the first face found
            top, right, bottom, left = face_locations[0]
            face_center_x = (left + right) // 2
            face_center_y = (top + bottom) // 2
            
            # Adjust x_offset to center on face if possible
            if face_center_x - crop_width//2 > 0 and face_center_x + crop_width//2 < width:
                x_offset = face_center_x - crop_width//2
    
    video.release()
    
    return {
        "crop_width": crop_width,
        "crop_height": crop_height,
        "x": x_offset,
        "y": y_offset
    }

def process_clip_task(task_id: str, video_path: str):
    """Process the video and generate a podcast-style clip."""
    try:
        if not os.path.isfile(video_path):
            with task_lock:
                task_store[task_id] = {
                    "status": "failed",
                    "result": {"error": f"File {video_path} does not exist."}
                }
            return

        video_uuid = str(uuid.uuid4())
        
        # Initialize transcriber and process video
        transcriber = Transcriber()
        transcription = transcriber.transcribe(audio_file_path=video_path)
        
        # Find clips
        clipfinder = ClipFinder(max_clip_duration=180)
        clips = clipfinder.find_clips(transcription=transcription)
        
        if not clips:
            with task_lock:
                task_store[task_id] = {
                    "status": "failed",
                    "result": {"error": "No suitable clips found in the video"}
                }
            return

        # Process the first clip (for podcast-style output)
        clip = clips[0]
        clip_file_path = generate_clip(video_path, clip, 0, video_uuid)
        
        # Perform dynamic resizing
        crop_info = custom_resize(clip_file_path)
        final_output_path = f"./podcast_{video_uuid}.mp4"
        
        # Use ffmpeg for the final resize
        cmd = [
            "ffmpeg", "-y",
            "-i", clip_file_path,
            "-vf", f"crop={crop_info['crop_width']}:{crop_info['crop_height']}:"
                   f"{crop_info['x']}:{crop_info['y']}",
            "-c:a", "copy",
            final_output_path
        ]
        subprocess.run(cmd, check=True)
        
        # Clean up temporary files
        os.remove(clip_file_path)
        
        with task_lock:
            task_store[task_id] = {
                "status": "completed",
                "result": {
                    "output_path": final_output_path,
                    "clip_duration": clip.end_time - clip.start_time,
                    "transcript": clip.text
                }
            }
            
    except Exception as e:
        with task_lock:
            task_store[task_id] = {
                "status": "failed",
                "result": {"error": str(e)}
            }

def seconds_to_srt_timestamp(seconds: float) -> str:
    """Converts seconds to SRT timestamp format (HH:MM:SS,mmm)."""
    hours, remainder = divmod(int(seconds), 3600)
    minutes, seconds = divmod(remainder, 60)
    milliseconds = int((seconds - int(seconds)) * 1000)
    return f"{hours:02}:{minutes:02}:{int(seconds):02},{milliseconds:03}"

# Add these new endpoints
@app.post("/generate_podcast_clip", response_model=TaskResponse)
def generate_podcast_clip(video_path: str = Body(..., embed=True)):
    """
    Takes a video path and generates a podcast-style clip with dynamic resizing.
    
    Request body example:
    {
        "video_path": "/path/to/video.mp4"
    }
    """
    task_id = str(uuid.uuid4())
    with task_lock:
        task_store[task_id] = {"status": "processing", "result": None}
    
    # Start processing in background
    threading.Thread(
        target=process_clip_task,
        args=(task_id, video_path),
        daemon=True
    ).start()
    
    return {"task_id": task_id, "status": "processing"}

@app.get("/clip_status/{task_id}", response_model=TaskResponse)
def get_clip_status(task_id: str):
    """Check the status of a clip generation task."""
    with task_lock:
        if task_id in task_store:
            task_info = task_store[task_id]
            return {
                "task_id": task_id,
                "status": task_info["status"],
                "result": task_info["result"]
            }
        return {"task_id": task_id, "status": "not found", "result": None}

OUTPUT_DIR = "extended_videos"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Initialize Boto3 S3 Client for AWS S3
s3_client = boto3.client(
    "s3",
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    region_name=os.getenv('AWS_REGION')
)

class VideoExtendRequest(BaseModel):
    video_path: str
    prompt: str  # For AI-based extension (not used in FFmpeg directly)
    duration: int

# Add after VideoExtendRequest class
CREATED_DIR = "created"
os.makedirs(CREATED_DIR, exist_ok=True)

# For local debugging:
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)