import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup", "/auth"];

// Her istekte oturumu yeniler ve giriş yapmamış kullanıcıyı giriş sayfasına yollar.
export async function proxy(request: NextRequest) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  let redirectTo: string | null = null;
  if (!user && !isPublic) redirectTo = "/login";
  if (user && (pathname === "/login" || pathname === "/signup")) redirectTo = "/";

  if (redirectTo) {
    const target = request.nextUrl.clone();
    target.pathname = redirectTo;
    target.search = "";
    const redirect = NextResponse.redirect(target);
    // Yenilenen oturum çerezleri yönlendirmede kaybolmasın.
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }

  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
