// Ambient declarations so the edge functions can be type-checked with tsc
// (`pnpm typecheck`) without a Deno toolchain. The Supabase runtime provides
// all of this; nothing here ships.

declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): unknown
}

declare module 'jsr:@std/encoding@1/base64' {
  export function encodeBase64(data: ArrayBuffer | Uint8Array | string): string
}
