export interface Env {
  CLIENT_ID?: string;
  CLIENT_SECRET?: string;
  REDIRECT_URI: string;
  FILE_NAME: string;
}

export interface SessionToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  token_type: string;
  clientId: string;
  clientSecret: string;
}
