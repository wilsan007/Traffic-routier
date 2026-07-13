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

  // --- Contrôle des flux vidéo continus (worker ML /streams) ---

  /** Démarre le traitement continu d'un flux (RTSP/HTTP) par le worker ML.
   * Renvoie l'identifiant du flux ML, ou null en cas d'échec. */
  async startStream(url: string, cameraId?: string): Promise<{ id: string } | null> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/streams`,
        { url, camera_id: cameraId ?? null },
        { headers: { 'x-api-key': this.serviceApiKey }, timeout: 15000 },
      );
      return { id: response.data.id as string };
    } catch (error) {
      this.logger.error(`Échec démarrage flux ML: ${(error as Error).message}`);
      return null;
    }
  }

  /** Arrête un flux ML par identifiant. Renvoie true si l'arrêt a réussi. */
  async stopStream(streamId: string): Promise<boolean> {
    try {
      await axios.delete(`${this.baseUrl}/streams/${streamId}`, {
        headers: { 'x-api-key': this.serviceApiKey },
        timeout: 10000,
      });
      return true;
    } catch (error) {
      this.logger.warn(`Échec arrêt flux ML ${streamId}: ${(error as Error).message}`);
      return false;
    }
  }

  /** Liste l'état des flux ML actifs (diagnostic). */
  async listStreams(): Promise<unknown[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/streams`, {
        headers: { 'x-api-key': this.serviceApiKey },
        timeout: 10000,
      });
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      this.logger.warn(`Échec liste flux ML: ${(error as Error).message}`);
      return [];
    }
  }
}
