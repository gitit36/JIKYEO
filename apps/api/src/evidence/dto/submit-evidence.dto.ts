import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Union DTO for `POST /v1/occurrences/:id/evidence`. The `kind` discriminator
 * selects which nested payload is validated. This intentionally covers only
 * modes iOS actually submits directly:
 *   - photo: SHA-256 of the image + capturedAt + storageKey (assigned by
 *     `evidence/upload-url` in production; MVP dev accepts the client's key)
 *   - gps:   user coordinates + accuracy + capturedAt
 *   - self:  "kept" or "missed"
 * Focus Timer completes through the timer endpoints and does NOT submit here.
 */
export type EvidenceKind = 'photo' | 'gps' | 'self';

class PhotoEvidenceDto {
  @IsString()
  storageKey!: string;

  @Matches(/^[a-f0-9]{64}$/i, { message: 'hash must be SHA-256 hex' })
  hash!: string;

  @IsOptional()
  @IsString()
  contentType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;

  /** ISO-8601 timestamp when the device captured the shot. */
  @IsString()
  capturedAt!: string;
}

class GpsEvidenceDto {
  @IsNumber() lat!: number;
  @IsNumber() lng!: number;
  @IsNumber() @Min(0) accuracyM!: number;
  @IsString() capturedAt!: string;
  @IsOptional()
  mockLocationSuspected?: boolean;
}

class SelfEvidenceDto {
  @IsIn(['kept', 'missed'])
  answer!: 'kept' | 'missed';
}

export class SubmitEvidenceDto {
  @IsIn(['photo', 'gps', 'self'])
  kind!: EvidenceKind;

  @IsOptional()
  @ValidateNested()
  @Type(() => PhotoEvidenceDto)
  photo?: PhotoEvidenceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => GpsEvidenceDto)
  gps?: GpsEvidenceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SelfEvidenceDto)
  self?: SelfEvidenceDto;
}
