import { NextResponse } from 'next/server';
import ffmpeg from 'fluent-ffmpeg';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

interface VideoFilters {
  brightness: number;
  contrast: number;
  saturation: number;
  rotation: number;
  filter: string;
  volume: number;
  bassBoost?: number;
  treble?: number;
}

interface Cut {
  cutStartTime: number;  // in seconds
  cutEndTime: number;    // in seconds
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const video = formData.get('video') as File;
    const cuts = JSON.parse(formData.get('cuts') as string) as Cut[];
    const filters = JSON.parse(formData.get('filters') as string) as VideoFilters;

    if (!video || !cuts || !filters) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Sort cuts by start time to ensure proper processing
    cuts.sort((a, b) => a.cutStartTime - b.cutStartTime);

    // Create temporary files
    const inputPath = join(tmpdir(), `input-${Date.now()}.mp4`);
    const outputPath = join(tmpdir(), `output-${Date.now()}.mp4`);
    const segmentPaths: string[] = [];
    const concatListPath = join(tmpdir(), `concat-${Date.now()}.txt`);

    // Write uploaded file to temp directory
    const bytes = await video.arrayBuffer();
    await writeFile(inputPath, Buffer.from(bytes));

    // Generate segments between cuts
    let lastEndTime = 0;
    for (let i = 0; i <= cuts.length; i++) {
      const segmentPath = join(tmpdir(), `segment-${i}-${Date.now()}.mp4`);
      segmentPaths.push(segmentPath);
      
      const startTime = lastEndTime;
      const endTime = i < cuts.length ? cuts[i].cutStartTime : video.size;
      lastEndTime = i < cuts.length ? cuts[i].cutEndTime : video.size;

      await new Promise((resolve, reject) => {
        const command = ffmpeg(inputPath)
          .output(segmentPath)
          .setStartTime(startTime);

        if (endTime !== video.size) {
          command.setDuration(endTime - startTime);
        }

        command
          .outputOptions(['-c', 'copy'])
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
    }

    // Create concat list
    const concatContent = segmentPaths
      .map(path => `file '${path}'`)
      .join('\n');
    await writeFile(concatListPath, concatContent);

    // Concatenate all segments
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // Read the processed file
    const processedVideo = await readFile(outputPath);

    // Clean up temp files
    await Promise.all([
      unlink(inputPath),
      unlink(concatListPath),
      unlink(outputPath),
      ...segmentPaths.map(path => unlink(path))
    ]);

    return new NextResponse(processedVideo, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="edited-video.mp4"'
      }
    });
  } catch (error) {
    console.error('Error processing video:', error);
    return NextResponse.json(
      { error: 'Error processing video' },
      { status: 500 }
    );
  }
}

function getTimeDifference(start: string, end: string): number {
  const [startHours, startMinutes, startSeconds] = start.split(':').map(Number);
  const [endHours, endMinutes, endSeconds] = end.split(':').map(Number);

  const startTotalSeconds = startHours * 3600 + startMinutes * 60 + startSeconds;
  const endTotalSeconds = endHours * 3600 + endMinutes * 60 + endSeconds;

  return endTotalSeconds - startTotalSeconds;
} 