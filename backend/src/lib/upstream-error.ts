export class UpstreamServiceError extends Error {
  readonly service: string;

  constructor(service: string, message: string) {
    super(message);
    this.name = "UpstreamServiceError";
    this.service = service;
  }
}
