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
    with open(f"output_{generate_hash}.mp3", "wb") as f:
        f.write(complete_audio)

    return f"output_{generate_hash}.mp3"

def generate_transcript(prompt: str):
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": f"Generate a transcript for the following prompt: {prompt}"}]
    )
    return response.choices[0].message.content

def generate_voiceover(prompt: str):
    transcript = generate_transcript(prompt)
    return elevenlabs_voiceover(transcript)

if __name__ == "__main__":
    generate_voiceover("Write a story about a cat that can fly. Make it less than 100 words. Optimize for this to be read by ElevenLabs voiceover.")