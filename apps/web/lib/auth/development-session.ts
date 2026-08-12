export const DEVELOPMENT_SESSION_COOKIE = "chaoren_development_session";

export function isDevelopmentAuthorizationEnabled() {
  const driver = process.env.AUTHORIZATION_DRIVER;
  return (
    process.env.NODE_ENV !== "production" && (driver === undefined || driver === "development")
  );
}
