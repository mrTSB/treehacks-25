import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(request: Request) {
  try {
    const { filename, data } = await request.json();
    
    // Create the raw directory if it doesn't exist
    const rawDir = path.join(process.cwd(), 'python-layer', 'raw');
    if (!fs.existsSync(rawDir)) {
      fs.mkdirSync(rawDir, { recursive: true });
    }

    // Convert base64 data to buffer
    const base64Data = data.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');

    // Save the file
    const filePath = path.join(rawDir, filename);
    fs.writeFileSync(filePath, buffer);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving video:', error);
    return NextResponse.json(
      { error: 'Failed to save video' },
      { status: 500 }
    );
  }
} 