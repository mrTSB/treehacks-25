import os
from lumaai import LumaAI
from dotenv import load_dotenv
from refiner import get_transcript
from openai import OpenAI
from moviepy.editor import VideoFileClip, concatenate_videoclips
import time
import requests
load_dotenv()

luma = LumaAI(auth_token=os.environ["LUMA_API_KEY"])
llm = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

def optimize_segments(transcript, duration):
    # Skip if transcript is empty
    if not transcript:
        return transcript
    
    # For all segments except the last one
    for i in range(len(transcript) - 1):
        transcript[i]["end"] = transcript[i + 1]["start"]
    transcript[-1]["end"] = duration
    
    return transcript

def create_video(video_path):
    transcript, duration = get_transcript(video_path)
    transcript = optimize_segments(transcript, duration)
    
    previous_segments = []
    video_clips = []
    
    for segment in transcript:
        segment_duration = segment["end"] - segment["start"]
        
        lumaPrompt = llm.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "We are generating a video from a transcript. You will be given a segment from a transcript, generate a prompt for a video generation model that will relate to the segment's text. You will be given previous transcript segments and their respective video prompts for context."},
                {"role": "user", "content": f"Create a video prompt for the following segment: {segment['text']}. Previous segments and their prompts: {previous_segments}"}
            ]
        ).choices[0].message.content
        
        previous_segments.append({
            "text": segment["text"],
            "prompt": lumaPrompt
        })
        
        generation = luma.generations.create(
            prompt=lumaPrompt,
            model="ray-2",
            duration=f"5s"
        )
        
        # Wait for generation to complete
        while generation.state != "completed":
            time.sleep(5)
            generation = luma.generations.get(generation.id)
            
        # Download the generated video
        video_path = f"temp_{len(video_clips)}.mp4"
        video_url = generation.assets.video
        response = requests.get(video_url, stream=True)
        with open(video_path, 'wb') as file:
            file.write(response.content)
        video_clips.append(VideoFileClip(video_path))
    
    # Combine all video clips
    final_video = concatenate_videoclips(video_clips)
    
    # Create generated_videos directory if it doesn't exist
    os.makedirs("generated_videos", exist_ok=True)
    
    # Save the final video
    output_path = os.path.join("generated_videos", os.path.basename(video_path))
    final_video.write_videofile(output_path)
    
    # Clean up temporary files
    for clip in video_clips:
        clip.close()
    for i in range(len(video_clips)):
        os.remove(f"temp_{i}.mp4")

if __name__ == "__main__":
    create_video("edited/IMG_4808.mp4")

