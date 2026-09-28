/** Public liveness response; intentionally contains no business models. */
export interface HealthResponse {
  status: 'ok';
  service: 'web' | 'api' | 'ai';
}
