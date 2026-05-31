import { MAX_DURATION_MINUTES, MIN_DURATION_MINUTES } from "@drive-map/shared";
import { z } from "zod";

const latSchema = z.number().finite().min(-90).max(90);
const lngSchema = z.number().finite().min(-180).max(180);

export const navigationStartRequestSchema = z.object({
  origin: z.object({
    lat: latSchema,
    lng: lngSchema
  }),
  durationMinutes: z.number().int().min(MIN_DURATION_MINUTES).max(MAX_DURATION_MINUTES)
});

export type NavigationStartRequestInput = z.infer<typeof navigationStartRequestSchema>;
