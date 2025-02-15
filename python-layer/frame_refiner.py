import os
import cv2
import numpy as np
from PIL import Image
import io
import time
import base64
from openai import OpenAI
from dotenv import load_dotenv

from key_frame_detector import keyframeDetection

def encode_image_to_base64(pil_image):
    """Convert PIL Image to base64 string"""
    buffered = io.BytesIO()
    pil_image.save(buffered, format="JPEG")
    return base64.b64encode(buffered.getvalue()).decode('utf-8')

def extract_frames_between_keyframes(video_path, keyframe_times, fps=3):
    """Extract frames between keyframes at specified fps"""
    cap = cv2.VideoCapture(video_path)
    video_fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frame_interval = int(video_fps / fps)
    
    # Ensure first segment starts at 0 and last segment ends at final frame
    keyframe_times = [0.0] + keyframe_times + [total_frames / video_fps]
    
    # Convert keyframe times to frame numbers
    keyframe_numbers = [int(t * video_fps) for t in keyframe_times]
    frames_by_segment = []
    
    for i in range(len(keyframe_numbers) - 1):
        start_frame = keyframe_numbers[i]
        end_frame = keyframe_numbers[i + 1]
        segment_frames = []
        
        # Always include the keyframe
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        ret, frame = cap.read()
        if ret:
            segment_frames.append(frame)
        
        # Get intermediate frames
        for frame_num in range(start_frame + frame_interval, end_frame, frame_interval):
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
            ret, frame = cap.read()
            if ret:
                segment_frames.append(frame)
        
        frames_by_segment.append(segment_frames)
    
    cap.release()
    return frames_by_segment

def frames_to_pil(frames):
    """Convert OpenCV frames to PIL Images"""
    pil_frames = []
    for frame in frames:
        # Convert from BGR to RGB
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(rgb_frame)
        pil_frames.append(pil_image)
    return pil_frames

def analyze_segment(frames, client):
    """Send frames to OpenAI for analysis"""
    # Convert frames to base64
    base64_images = [encode_image_to_base64(frame) for frame in frames]
    
    # Construct the messages with all frames
    content = [{"type": "text", "text": "Analyze these sequential frames from a video and describe what is happening in this segment. Focus on the main action or changes occurring."}]
    
    # Add each image to the content
    for base64_image in base64_images:
        content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{base64_image}"
            }
        })
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": content
            }],
        )
        return response.choices[0].message.content
    except Exception as e:
        return f"Error analyzing segment: {str(e)}"

def main():
    video_path = "raw/acrobacia.mp4"
    
    # Initialize OpenAI client
    load_dotenv()
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    
    # Get keyframes
    print("Detecting keyframes...")
    keyframe_times = keyframeDetection(video_path, 0.3, plotMetrics=False)
    
    # Extract frames between keyframes
    print("Extracting frames between keyframes...")
    frames_by_segment = extract_frames_between_keyframes(video_path, keyframe_times)
    
    # Analyze each segment
    print("\nAnalyzing segments:")
    for i, segment_frames in enumerate(frames_by_segment):
        print(f"\nSegment {i + 1} (between {keyframe_times[i]:.2f}s and {keyframe_times[i+1]:.2f}s):")
        pil_frames = frames_to_pil(segment_frames)
        analysis = analyze_segment(pil_frames, client)
        print(analysis)
        time.sleep(1)  # Rate limiting for API calls

if __name__ == "__main__":
    main() 