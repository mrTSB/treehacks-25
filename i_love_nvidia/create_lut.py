import numpy as np
from dataclasses import dataclass
import subprocess
import os
import sys
from typing import Optional
from pydantic import BaseModel, Field, confloat
import openai
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Initialize OpenAI client
openai.api_key = os.getenv("OPENAI_API_KEY")

class LUTConfig(BaseModel):
    """Pydantic model for LUT configuration with value constraints"""
    # Basic adjustments
    brightness: confloat(ge=0.5, le=2.0) = Field(
        default=1.0,
        description="Overall brightness multiplier"
    )
    contrast: confloat(ge=0.8, le=2.0) = Field(
        default=1.3,
        description="Contrast strength"
    )
    saturation: confloat(ge=0.0, le=2.0) = Field(
        default=1.1,
        description="Color saturation"
    )
    
    # Color temperature
    temperature: confloat(ge=3200, le=7500) = Field(
        default=5500,
        description="Color temperature in Kelvin"
    )
    tint: confloat(ge=-1.0, le=1.0) = Field(
        default=0.0,
        description="Green-Magenta tint"
    )
    
    # Tone mapping
    highlight_rolloff: confloat(ge=0.5, le=1.0) = Field(
        default=0.7,
        description="Highlight compression"
    )
    shadow_lift: confloat(ge=0.0, le=0.1) = Field(
        default=0.02,
        description="Shadow lifting"
    )
    black_point: confloat(ge=0.0, le=0.02) = Field(
        default=0.002,
        description="Minimum black level"
    )
    
    # Color grading
    highlight_warmth: confloat(ge=1.0, le=1.2) = Field(
        default=1.05,
        description="Warm tint in highlights"
    )
    shadow_coolness: confloat(ge=0.8, le=1.0) = Field(
        default=0.95,
        description="Cool tint in shadows"
    )
    
    # Advanced adjustments
    midtone_contrast: confloat(ge=1.0, le=1.5) = Field(
        default=1.2,
        description="Additional contrast in midtones"
    )
    gamma: confloat(ge=0.3, le=0.6) = Field(
        default=0.42,
        description="Gamma adjustment"
    )

async def generate_config_from_description(description: str) -> LUTConfig:
    """Generate a LUT configuration from a text description using OpenAI"""
    try:
        response = await openai.chat.completions.create(
            model="gpt-4-turbo-preview",
            response_format=LUTConfig,
            messages=[
                {"role": "system", "content": """You are an expert cinematographer and colorist. 
                Generate LUT configurations based on descriptions. Output must be valid JSON matching 
                the LUTConfig schema with these constraints:
                - brightness: 0.5 to 2.0
                - contrast: 0.8 to 2.0
                - saturation: 0.0 to 2.0
                - temperature: 3200K to 7500K
                - tint: -1.0 to 1.0 (negative for magenta, positive for green)
                - highlight_rolloff: 0.5 to 1.0
                - shadow_lift: 0.0 to 0.1
                - black_point: 0.0 to 0.02
                - highlight_warmth: 1.0 to 1.2
                - shadow_coolness: 0.8 to 1.0
                - midtone_contrast: 1.0 to 1.5
                - gamma: 0.3 to 0.6"""},
                {"role": "user", "content": f"Generate a LUT configuration for this look: {description}"}
            ]
        )
        
        # Parse the response into our Pydantic model
        config_dict = response.choices[0].message.content
        return LUTConfig.parse_raw(config_dict)
    
    except Exception as e:
        print(f"Error generating configuration: {e}")
        # Return default config if generation fails
        return LUTConfig()

def get_preset_config(preset_name="cinematic") -> LUTConfig:
    """Get a predefined configuration preset"""
    presets = {
        "cinematic": LUTConfig(
            brightness=1.1,
            contrast=1.3,
            saturation=1.1,
            temperature=5600,
            tint=0.0,
            highlight_rolloff=0.7,
            shadow_lift=0.02,
            black_point=0.002,
            highlight_warmth=1.05,
            shadow_coolness=0.95,
            midtone_contrast=1.2,
            gamma=0.42
        ),
        "warm_vintage": LUTConfig(
            brightness=1.05,
            contrast=1.4,
            saturation=0.9,
            temperature=5000,
            tint=0.1,
            highlight_rolloff=0.8,
            shadow_lift=0.03,
            black_point=0.005,
            highlight_warmth=1.1,
            shadow_coolness=0.9,
            midtone_contrast=1.3,
            gamma=0.45
        )
    }
    return presets.get(preset_name, presets["cinematic"])

async def main(input_video: str, output_video: str, preset_name: Optional[str] = None, 
         description: Optional[str] = None, custom_config: Optional[LUTConfig] = None) -> bool:
    """
    Main function to generate a LUT and apply it to a video
    
    Args:
        input_video (str): Path to input video file
        output_video (str): Path to output video file
        preset_name (str, optional): Name of preset to use
        description (str, optional): Text description for AI-generated config
        custom_config (LUTConfig, optional): Custom configuration
    
    Returns:
        bool: True if successful, False otherwise
    """
    # Validate input video exists
    if not os.path.exists(input_video):
        print(f"Error: Input video {input_video} not found")
        return False
    
    try:
        # Determine configuration source
        if custom_config:
            config = custom_config
            config_name = "custom"
        elif description:
            print(f"Generating configuration from description: {description}")
            config = await generate_config_from_description(description)
            config_name = "ai_generated"
        else:
            config = get_preset_config(preset_name or "cinematic")
            config_name = preset_name or "cinematic"
        
        print(f"Using {config_name} configuration")
        
        # Create LUT file
        lut_file = create_lut(config, config_name)
        print(f"Created LUT file: {lut_file}")
        
        # Apply LUT to video
        print(f"Applying LUT to {input_video}...")
        success = apply_lut(lut_file, input_video, output_video)
        
        if success:
            print(f"Successfully processed video: {output_video}")
        return success
        
    except Exception as e:
        print(f"Error processing video: {e}")
        return False

def create_lut(config: LUTConfig, name: str = "custom") -> str:
    """
    Create a 3D LUT file based on the provided configuration.
    
    Args:
        config: LUTConfig object containing the color grading parameters
        name: Name to use in the output LUT filename
    
    Returns:
        str: Path to the created LUT file
    """
    lut_size = 32  # Standard size for 3D LUT
    output_file = f"{name.lower().replace(' ', '_')}.cube"  # Use .cube extension for better compatibility
    
    with open(output_file, 'w') as f:
        # Write header
        f.write("# Created with create_lut.py\n")
        f.write(f"# Configuration: {config.model_dump_json()}\n")
        f.write("TITLE \"Custom LUT\"\n")
        f.write(f"LUT_3D_SIZE {lut_size}\n\n")
        
        # Generate LUT entries
        for b in range(lut_size):
            for g in range(lut_size):
                for r in range(lut_size):
                    # Convert indices to normalized RGB values (0-1)
                    rgb = [x / (lut_size - 1) for x in (r, g, b)]
                    
                    # Convert to linear light
                    linear = video_to_linear(rgb)
                    
                    # Apply color grading
                    graded = enhance_video(linear, config)
                    
                    # Convert back to display gamma
                    display = linear_to_rec709(graded, config)
                    
                    # Clamp values between 0 and 1
                    display = [max(0.0, min(1.0, x)) for x in display]
                    
                    # Write the RGB values
                    f.write(f"{display[0]:.6f} {display[1]:.6f} {display[2]:.6f}\n")
    
    return output_file

def video_to_linear(rgb):
    """Convert video gamma to linear light"""
    return [pow(x, 2.4) for x in rgb]

def linear_to_rec709(rgb, config: LUTConfig):
    """Convert linear light to Rec.709 with contrast adjustment"""
    # Apply gamma correction with configurable contrast
    gamma = config.gamma
    contrast = config.contrast
    brightness = config.brightness
    
    try:
        # Apply contrast and brightness, ensure values stay positive
        rgb = [max(0.0, x * brightness) for x in rgb]
        rgb = [max(0.0, pow(x, contrast)) for x in rgb]
        
        # Apply gamma correction
        rgb = [max(0.0, pow(x, gamma)) for x in rgb]
        
        return rgb
    except ValueError:
        # If we get any math errors, return a safe value
        return [0.0, 0.0, 0.0]

def enhance_video(rgb, config: LUTConfig):
    """Apply video enhancement based on configuration"""
    try:
        # Calculate luminance
        luminance = max(0.0, 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2])
        
        # Apply highlight rolloff
        highlight_factor = 1.0 - (1.0 - config.highlight_rolloff) * luminance
        rgb = [max(0.0, x * highlight_factor) for x in rgb]
        
        # Apply shadow lift
        shadow_factor = config.shadow_lift * (1.0 - luminance)
        rgb = [max(0.0, x + shadow_factor) for x in rgb]
        
        # Apply black point
        rgb = [max(x, config.black_point) for x in rgb]
        
        # Apply color temperature adjustment
        temp_factor = (config.temperature - 5500) / 1000  # Normalize around 5500K
        rgb = [
            max(0.0, rgb[0] * (1 + 0.1 * temp_factor)),  # Red
            rgb[1],                                       # Green
            max(0.0, rgb[2] * (1 - 0.1 * temp_factor))   # Blue
        ]
        
        # Apply saturation
        if config.saturation != 1.0:
            # Convert to HSL-like space for saturation adjustment
            rgb_sum = sum(rgb)
            if rgb_sum > 0:
                rgb = [
                    max(0.0, ((x / rgb_sum) * config.saturation + (1 - config.saturation) / 3) * rgb_sum)
                    for x in rgb
                ]
        
        # Apply highlight warmth and shadow coolness
        if luminance > 0.5:
            # Warm highlights
            factor = (luminance - 0.5) * 2 * (config.highlight_warmth - 1.0)
            rgb[0] = max(0.0, rgb[0] * (1 + factor))  # Increase red
            rgb[2] = max(0.0, rgb[2] * (1 - factor))  # Decrease blue
        else:
            # Cool shadows
            factor = (0.5 - luminance) * 2 * (1.0 - config.shadow_coolness)
            rgb[0] = max(0.0, rgb[0] * (1 - factor))  # Decrease red
            rgb[2] = max(0.0, rgb[2] * (1 + factor))  # Increase blue
        
        return rgb
        
    except (ValueError, ZeroDivisionError):
        # If we get any math errors, return the input unchanged
        return rgb

def apply_lut(lut_file: str, input_video: str, output_video: str) -> bool:
    """
    Apply a LUT to a video using ffmpeg_lut.
    
    Args:
        lut_file: Path to the LUT file (.cube format)
        input_video: Path to the input video
        output_video: Path to the output video
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Get the absolute path to ffmpeg_lut
        ffmpeg_lut = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ffmpeg_lut")
        
        # Check if ffmpeg_lut exists and is executable
        if not os.path.exists(ffmpeg_lut):
            print(f"Error: {ffmpeg_lut} not found")
            return False
        
        if not os.access(ffmpeg_lut, os.X_OK):
            print(f"Error: {ffmpeg_lut} is not executable")
            return False
        
        # Ensure the LUT file has .cube extension
        if not lut_file.endswith('.cube'):
            print(f"Error: LUT file must have .cube extension")
            return False
        
        # Run ffmpeg_lut command
        command = [ffmpeg_lut, lut_file, input_video, output_video]
        result = subprocess.run(command, capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"Error applying LUT: {result.stderr}")
            return False
            
        return True
        
    except Exception as e:
        print(f"Error applying LUT: {e}")
        return False

if __name__ == "__main__":
    import asyncio
    
    # Example descriptions for different looks
    example_looks = {
        "modern_cinematic": "A clean, modern cinematic look with natural contrast, slightly warm highlights, and deep but not crushed blacks. Maintain natural skin tones with a subtle filmic feel.",
        
        "vintage_film": "A warm, vintage film look reminiscent of 70s movies. Slightly faded blacks, warm golden highlights, and slightly desaturated colors with a touch of cross-processing in the shadows.",
        
        "moody_thriller": "A tense, moody look for thrillers. Cool shadows, neutral highlights, increased contrast, and slightly desaturated colors. Deep blacks and a touch of blue in the shadows.",
        
        "summer_blockbuster": "A vibrant, high-contrast look typical of summer blockbusters. Rich colors, strong contrast, warm highlights, and deep blacks. Slightly increased saturation for an energetic feel.",
        
        "documentary": "A natural, true-to-life documentary style. Neutral color temperature, moderate contrast, and natural saturation. Preserve highlight and shadow detail for a clean, professional look.",
        
        "music_video": "A stylized music video look with crushed blacks, saturated colors, and high contrast. Cool shadows and warm highlights for a modern, edgy feel. Slightly raised black point for a polished look."
    }
    
    if len(sys.argv) > 2:
        # Use command line arguments if provided
        input_video = sys.argv[1]
        output_video = sys.argv[2]
        
        # Check for description or preset
        if len(sys.argv) > 3:
            if sys.argv[3].startswith('"') or sys.argv[3].startswith("'"):
                # It's a description
                description = sys.argv[3].strip("'\"")
                asyncio.run(main(input_video, output_video, description=description))
            else:
                # It's a preset name
                asyncio.run(main(input_video, output_video, preset_name=sys.argv[3]))
        else:
            # Use default preset
            asyncio.run(main(input_video, output_video))
    else:
        # Print example usage
        print("\nExample Usage:")
        print("1. Using a preset:")
        print("   python create_lut.py input.mp4 output.mp4 cinematic")
        print("   python create_lut.py input.mp4 output.mp4 warm_vintage")
        print("\n2. Using a description:")
        print('   python create_lut.py input.mp4 output.mp4 "moody cinematic look with deep shadows"')
        
        print("\nExample Descriptions for Different Looks:")
        for look, desc in example_looks.items():
            print(f"\n{look.replace('_', ' ').title()}:")
            print(f"  {desc}")
        
        # Run with default example
        print("\nRunning with example modern cinematic look...")
        asyncio.run(main("test_lut.mp4", "output_lut.mp4", 
                        description=example_looks["modern_cinematic"]))


