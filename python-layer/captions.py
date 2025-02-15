import os
import uuid
import subprocess
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs
from openai import OpenAI

from fastapi import FastAPI, Body
from fastapi.responses import FileResponse
from moviepy.editor import VideoFileClip, AudioFileClip
from pydub import AudioSegment
from refiner import get_transcript
app = FastAPI()

# Load environment variables
load_dotenv()
elevenlabs_client = ElevenLabs(api_key=os.getenv("ELEVENLABS_API_KEY"))
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def seconds_to_srt_timestamp(seconds: float) -> str:
    """
    Converts a float number of seconds to an SRT timestamp (HH:MM:SS,mmm).
    For example: 3.5 -> "00:00:03,500"
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds - int(seconds)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

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


def generate_subtitled_video(video_path: str) -> str:
    """
    Takes a local path to a video file, generates subtitles using Whisper,
    and returns a path to the newly created video with burned-in subtitles.
    """
    if not os.path.isfile(video_path):
        return {"error": f"File {video_path} does not exist."}

    # Create captioned directory if it doesn't exist
    os.makedirs("captioned", exist_ok=True)

    segments, duration = get_transcript(video_path)

    unique_prefix = str(uuid.uuid4())[:8]
    srt_filename = f"subtitles_{unique_prefix}.srt"
    output_video_filepath = f"captioned/subtitled_{unique_prefix}.mp4"

    with open(srt_filename, "w", encoding="utf-8") as f:
        for i, segment in enumerate(segments):
            start = seconds_to_srt_timestamp(segment["start"])
            end = seconds_to_srt_timestamp(segment["end"])
            text = segment["text"].strip()
            f.write(f"{i+1}\n{start} --> {end}\n{text}\n\n")

    # Updated ffmpeg command with subtitle positioning
    cmd = ["ffmpeg", "-y", "-i", video_path, 
           "-vf", f"subtitles={srt_filename}:force_style='Alignment=10,MarginV=0'", 
           output_video_filepath]
    subprocess.run(cmd, check=True)

    os.remove(srt_filename)
    return output_video_filepath


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

def main():
    video_path = "raw/IMG_4808.mp4"
    output_path = generate_subtitled_video(video_path)
    print(output_path)

if __name__ == "__main__":
    main()

