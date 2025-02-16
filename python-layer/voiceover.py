import random
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs
from elevenlabs import stream
import os
from openai import OpenAI
load_dotenv()

client = ElevenLabs(api_key=os.getenv("ELEVENLABS_API_KEY"))

def elevenlabs_voiceover(text: str, voice_id: str = "JBFqnCBsd6RMkjVDRZzb"):
    # Create an audio stream
    audio_stream = client.text_to_speech.convert_as_stream(
        text=text,
        voice_id=voice_id,
        model_id="eleven_multilingual_v2"
    )

    # Create a list to store audio chunks
    audio_chunks = []

    # Process the audio stream and collect chunks
    for chunk in audio_stream:
        if isinstance(chunk, bytes):
            audio_chunks.append(chunk)

    # Combine all chunks into a single bytes object
    complete_audio = b''.join(audio_chunks)

    generate_hash = ''.join(random.choices('0123456789abcdef', k=8))
    # Save the audio to a file
    filename = f"output_{generate_hash}.mp3"
    with open(filename, "wb") as f:
        f.write(complete_audio)

    return filename


def transcribe_audio_whisper(audio_path: str) -> str:
    """
    Transcribe an audio file using OpenAI's Whisper model.
    
    Parameters:
      audio_path (str): Path to the input audio file.
    
    Returns:
      str: The transcribed text.
    """
    # Initialize the OpenAI client
    client = OpenAI()
    
    with open(audio_path, "rb") as audio_file:
        # Use the new API format
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file
        )
        
        # The response format has changed - transcript is now an object with a text property
        return transcript.text


def change_speed(sound, speed: float):
    """
    Change the playback speed of a pydub AudioSegment.
    A speed factor >1 will speed up playback (reducing duration).
    
    Parameters:
      sound (AudioSegment): The original audio.
      speed (float): The speed factor to adjust the playback.
    
    Returns:
      AudioSegment: The speed-adjusted audio.
    """
    # Change frame_rate to shift the playback speed.
    new_frame_rate = int(sound.frame_rate * speed)
    altered_sound = sound._spawn(sound.raw_data, overrides={"frame_rate": new_frame_rate})
    # Reset frame rate so that the sample rate is standard.
    return altered_sound.set_frame_rate(sound.frame_rate)


def adjust_voiceover_speed(voiceover_path: str, target_duration: float) -> str:
    """
    Adjust the speed of the generated voiceover so that its duration 
    matches the target duration (in seconds). Only speeds up the audio,
    never slows it down.
    
    Parameters:
      voiceover_path (str): Path to the generated voiceover MP3 file.
      target_duration (float): The desired duration (in seconds).
      
    Returns:
      str: Filename of the new adjusted audio file.
    """
    from pydub import AudioSegment

    # Load the generated voiceover audio.
    voice_audio = AudioSegment.from_file(voiceover_path, format="mp3")
    voice_duration = voice_audio.duration_seconds
    if voice_duration == 0:
        raise ValueError("Generated voiceover duration is zero.")

    # Only speed up if the voiceover is longer than the target duration
    speed_factor = 1.0
    if voice_duration > target_duration:
        speed_factor = voice_duration / target_duration
    adjusted_audio = change_speed(voice_audio, speed_factor)

    # Create a new filename for the adjusted audio.
    adjusted_filename = f"adjusted_{voiceover_path}"
    adjusted_audio.export(adjusted_filename, format="mp3")
    
    return adjusted_filename


def process_voiceover(video_path: str, voice_id: str = "JBFqnCBsd6RMkjVDRZzb") -> str:
    """
    Full pipeline: 
    1. Extract audio from the input video file
    2. Extract the target duration from the video's audio
    3. Transcribe the audio using OpenAI's Whisper
    4. Generate a voiceover using ElevenLabs TTS from the transcript
    5. Adjust the synthesized voiceover's speed so that its duration 
       matches the original video's audio duration
    
    Parameters:
      video_path (str): Path to the input video file
      voice_id (str): (Optional) ElevenLabs voice ID to use for synthesis
    
    Returns:
      str: Filename of the final, speed-adjusted voiceover audio
    """
    from pydub import AudioSegment
    import moviepy.editor as mp
    
    # Extract audio from video
    video = mp.VideoFileClip(video_path)
    temp_audio_path = "temp_audio.mp3"
    video.audio.write_audiofile(temp_audio_path)
    video.close()
    
    # Load the extracted audio to get the target duration
    original_audio = AudioSegment.from_file(temp_audio_path)
    target_duration = original_audio.duration_seconds

    # Transcribe the audio using Whisper
    transcript = transcribe_audio_whisper(temp_audio_path)
    
    # Generate a voiceover from the transcript using ElevenLabs
    voiceover_file = elevenlabs_voiceover(transcript, voice_id)
    
    # Adjust the voiceover speed so it fits exactly into the target duration
    adjusted_voiceover_file = adjust_voiceover_speed(voiceover_file, target_duration)
    
    # Clean up temporary audio file
    os.remove(temp_audio_path)
    os.remove(voiceover_file)
    
    return adjusted_voiceover_file

def combine_voiceover_and_video(video_path: str, voiceover_path: str) -> str:
    """
    Combines a video file with a voiceover audio file.
    If the voiceover is shorter than the video, the remaining duration will be silent.
    
    Parameters:
        video_path (str): Path to the input video file
        voiceover_path (str): Path to the voiceover audio file
    
    Returns:
        str: Path to the output video file with combined audio
    """
    import moviepy.editor as mp
    
    # Load the video and voiceover
    video = mp.VideoFileClip(video_path)
    voiceover = mp.AudioFileClip(voiceover_path)
    
    # Create the output filename
    output_path = f"output_{os.path.basename(video_path)}"
    
    # Set the voiceover as the audio for the video
    final_video = video.set_audio(voiceover)
    
    # Write the final video file
    final_video.write_videofile(output_path, codec='libx264', audio_codec='aac')
    
    # Clean up
    video.close()
    voiceover.close()
    
    return output_path

async def generate_voiceover(video_path: str) -> str:
    """
    Full pipeline:
    1. Process the video's audio to get the target duration
    2. Generate a voiceover from the transcript using ElevenLabs TTS
    3. Adjust the synthesized voiceover's speed and combine with video
    
    Parameters:
        video_path (str): Path to the input video file
    
    Returns:
        str: Path to the output video file with voiceover
    """ 
    try:
        voiceover_path = process_voiceover(video_path)
        combined_path = combine_voiceover_and_video(video_path, voiceover_path)
        
        # Clean up intermediate files
        os.remove(voiceover_path)
        
        return combined_path
    except Exception as e:
        print(f"Error generating voiceover: {str(e)}")
        raise

async def main():
    result = await generate_voiceover("raw/IMG_4806.mp4")
    print(f"Generated voiceover video: {result}")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())