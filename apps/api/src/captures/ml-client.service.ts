import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as FormData from 'form-data';

export interface PlateDetectionResult {
  plateText: string;
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

@Injectable()
export class MlClientService {
  private readonly logger = new Logger(MlClientService.name);
  private readonly baseUrl: string;
  private readonly serviceApiKey: string;

  constructor(private config: ConfigService) {
    this.baseUrl = this.config.get<string>('ML_SERVICE_URL') ?? 'http://localhost:8000';
    this.serviceApiKey = this.config.get<string>('SERVICE_API_KEY') ?? 'dev-service-key';
  }

  async detectPlate(imageBuffer: Buffer, filename = 'capture.jpg'): Promise<PlateDetectionResult> {
    const form = new FormData();
    form.append('image', imageBuffer, filename);

    try {
      const response = await axios.post(`${this.baseUrl}/detect`, form, {
        headers: { ...form.getHeaders(), 'x-api-key': this.serviceApiKey },
        timeout: 15000,
      });
      return {
        plateText: response.data.plate_text ?? '',
        confidence: response.data.confidence ?? 0,
        boundingBox: response.data.bounding_box ?? undefined,
      };
    } catch (error) {
      this.logger.error(`Échec appel au service ML: ${(error as Error).message}`);
      return { plateText: '', confidence: 0 };
    }
  }
}
