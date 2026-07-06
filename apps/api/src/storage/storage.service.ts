import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as AWS from 'aws-sdk';
import { randomUUID } from 'crypto';

@Injectable()
export class StorageService {
  private s3: AWS.S3;
  private bucket: string;
  private endpoint: string;

  constructor(private config: ConfigService) {
    this.endpoint = this.config.get<string>('S3_ENDPOINT') ?? 'http://localhost:9000';
    this.bucket = this.config.get<string>('S3_BUCKET') ?? 'trafficguard-captures';
    this.s3 = new AWS.S3({
      endpoint: this.endpoint,
      accessKeyId: this.config.get<string>('S3_ACCESS_KEY') ?? 'minioadmin',
      secretAccessKey: this.config.get<string>('S3_SECRET_KEY') ?? 'minioadmin',
      s3ForcePathStyle: true,
      signatureVersion: 'v4',
      region: this.config.get<string>('S3_REGION') ?? 'us-east-1',
    });
  }

  async ensureBucket() {
    try {
      await this.s3.headBucket({ Bucket: this.bucket }).promise();
    } catch {
      await this.s3.createBucket({ Bucket: this.bucket }).promise();
    }
  }

  async uploadCaptureImage(buffer: Buffer, mimeType = 'image/jpeg'): Promise<string> {
    await this.ensureBucket();
    const key = `captures/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.jpg`;
    await this.s3
      .putObject({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: mimeType })
      .promise();
    return `${this.endpoint}/${this.bucket}/${key}`;
  }

  // Suppression best-effort d'une image à partir de son URL (purge RGPD)
  async deleteByUrl(url: string): Promise<boolean> {
    const prefix = `/${this.bucket}/`;
    const idx = url.indexOf(prefix);
    if (idx === -1) return false;
    const key = url.slice(idx + prefix.length);
    try {
      await this.s3.deleteObject({ Bucket: this.bucket, Key: key }).promise();
      return true;
    } catch {
      return false;
    }
  }
}
