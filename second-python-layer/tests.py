import time
from main import generate_podcast_clip, get_clip_status
import os

def test_generate_podcast_clips_timing():
    """Test the full podcast clip generation process"""
    # Test parameters
    input_file = "./steve.mp4"
    
    if not os.path.exists(input_file):
        print(f"Error: Test file {input_file} not found")
        return False
    
    print("Starting podcast clip generation test...")
    
    # Record start time
    start_time = time.time()
    
    try:
        # Start the generation process
        response = generate_podcast_clip(input_file)
        task_id = response["task_id"]
        print(f"Task started with ID: {task_id}")
        
        # Poll for completion
        while True:
            status = get_clip_status(task_id)
            print(f"Current status: {status['status']}")
            
            if status['status'] == 'completed':
                # Calculate and print execution time
                execution_time = time.time() - start_time
                print(f"Successfully generated podcast clip")
                print(f"Execution time: {execution_time:.2f} seconds")
                print(f"Output path: {status['result']['output_path']}")
                print(f"Clip duration: {status['result']['clip_duration']:.2f} seconds")
                print(f"Transcript: {status['result']['transcript']}")
                return True
                
            elif status['status'] == 'failed':
                print(f"Generation failed: {status['result'].get('error', 'Unknown error')}")
                return False
                
            # Wait before polling again
            time.sleep(2)
            
    except Exception as e:
        print(f"Error during podcast clip generation: {str(e)}")
        return False

if __name__ == "__main__":
    # Run the test
    test_generate_podcast_clips_timing()
