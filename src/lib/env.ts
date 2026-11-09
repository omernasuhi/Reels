import "server-only";

const e = process.env;

export const env = {
  appUrl: (e.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  supabaseUrl: e.SUPABASE_URL ?? "",
  supabaseAnonKey: e.SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY ?? "",
  adminEmails: (e.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),

  claudeModel: e.CLAUDE_MODEL || "claude-sonnet-5-5",

  replicateToken: e.REPLICATE_API_TOKEN ?? "",
  replicateModel: e.REPLICATE_IMAGE_MODEL || "bytedance/seedream-5-pro",
  replicateWebhookSecret: e.REPLICATE_WEBHOOK_SECRET ?? "",
  imageConcurrency: Math.max(1, Number(e.IMAGE_CONCURRENCY) || 8),

  elevenKey: e.ELEVENLABS_API_KEY ?? "",
  elevenVoiceId: e.ELEVENLABS_VOICE_ID ?? "",
  elevenModel: e.ELEVENLABS_MODEL || "eleven_v3",

  r2AccountId: e.R2_ACCOUNT_ID ?? "",
  r2AccessKeyId: e.R2_ACCESS_KEY_ID ?? "",
  r2SecretAccessKey: e.R2_SECRET_ACCESS_KEY ?? "",
  r2Bucket: e.R2_BUCKET ?? "",
  // R2 yoksa dosyalar bu klasöre yazılır (yalnızca tek sunuculu kurulum için).
  localStorageDir: e.LOCAL_STORAGE_DIR || ".data/storage",
  fileSigningSecret: e.FILE_SIGNING_SECRET || e.SUPABASE_SERVICE_ROLE_KEY || "dev-secret",

  ffmpegPath: e.FFMPEG_PATH || "ffmpeg",
  ffprobePath: e.FFPROBE_PATH || "ffprobe",

  remotionRegion: e.REMOTION_AWS_REGION ?? "",
  remotionFunctionName: e.REMOTION_FUNCTION_NAME ?? "",
  remotionServeUrl: e.REMOTION_SERVE_URL ?? "",
  remotionBrowserExecutable: e.REMOTION_BROWSER_EXECUTABLE ?? "",
};

export const isSupabaseConfigured = Boolean(
  env.supabaseUrl && env.supabaseAnonKey && env.supabaseServiceRoleKey,
);
export const isR2Configured = Boolean(
  env.r2AccountId && env.r2AccessKeyId && env.r2SecretAccessKey && env.r2Bucket,
);
export const isLambdaConfigured = Boolean(
  env.remotionRegion && env.remotionFunctionName && env.remotionServeUrl,
);
// Replicate webhook'u yalnızca dışarıdan erişilebilir bir adreste çalışır.
export const isWebhookReachable =
  env.appUrl.startsWith("https://") && Boolean(env.replicateWebhookSecret);
