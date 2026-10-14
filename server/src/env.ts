/**
 * Worker bindings. `Env` comes from `wrangler types`; `AUTH_SERVICE` is the optional service binding to
 * JoyoRogo that is commented out in wrangler.jsonc, so it is not part of the generated type.
 */
export type AppEnv = Env & { AUTH_SERVICE?: Fetcher };

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export type AppContext = {
  Bindings: AppEnv;
  Variables: { user: AuthUser };
};
