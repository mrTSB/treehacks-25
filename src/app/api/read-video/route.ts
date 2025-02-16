import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(request: Request) {
  try {
    const { filePath, pythonLayer } = await request.json();
    
    // Construct the full path to the video file
    const fullPath = path.join(process.cwd(), pythonLayer, filePath);
    
    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json(
        { error: 'Video file not found' },
        { status: 404 }
      );
    }

    // Read the file
    const videoBuffer = fs.readFileSync(fullPath);
    
    // Create and return response with proper headers
    return new NextResponse(videoBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': videoBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Error reading video:', error);
    return NextResponse.json(
      { error: 'Failed to read video' },
      { status: 500 }
    );
  }
} 