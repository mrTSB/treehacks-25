# For local debugging:
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import os
from create_lut import main
from pydantic import BaseModel

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins in development
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods including OPTIONS
    allow_headers=["*"],  # Allow all headers
    expose_headers=["*"],  # Expose all headers
)

class FilterRequest(BaseModel):
    video_path: str
    description: str

@app.post("/apply-filters")
async def apply_filters(request: FilterRequest):
    try:
        # Generate output path by adding '_filtered' before the extension
        base, ext = os.path.splitext(request.video_path)
        output_path = f"{base}_filtered{ext}"
        
        # Call the main function from create_lut.py
        success = await main(
            input_video=request.video_path,
            output_video=output_path,
            description=request.description
        )
        
        if success:
            return {"status": "success", "output_path": output_path}
        else:
            return {"status": "error", "message": "Failed to apply filters"}
            
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8004)