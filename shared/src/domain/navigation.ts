export type DistanceAnnouncementBucket = 800 | 600 | 400 | 200 | 100 | 50 | "soon";

export type NavigationUiState = {
  currentStepIndex: number;
  instruction: string;
  remainingStepDistanceMeters: number;
  bucket: DistanceAnnouncementBucket;
};
