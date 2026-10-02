import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { ClerkProvider, Show, SignIn, useAuth } from "@clerk/react";
import { shadcn } from "@clerk/ui/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { UtensilsCrossed } from "lucide-react";
import { router } from "./router";
import { Toaster } from "./components/ui/sonner";
import { styles as shell } from "./dashboard-styles";
import { colors } from "./theme.stylex";

// The server adds the publishable key to the page, so one build serves any Clerk instance.
const publishableKey = document.querySelector<HTMLMetaElement>('meta[name="nouri-clerk-publishable-key"]')?.content ?? "";

// Clerk's shadcn theme reads the same :root variables as components/ui, so sign-in matches the app.
const appearance = { theme: shadcn };

export function Session() {
  return (
    <ClerkProvider publishableKey={publishableKey} appearance={appearance} afterSignOutUrl="/">
      <Show when="signed-out">
        <main {...stylex.props(styles.page)}>
          <p {...stylex.props(shell.brand)}>
            <span {...stylex.props(shell.brandIcon)}><UtensilsCrossed size={17} strokeWidth={2.5} /></span>
            NOURI
          </p>
          <SignIn routing="hash" withSignUp />
        </main>
      </Show>
      <Show when="signed-in">
        <SignedIn />
      </Show>
    </ClerkProvider>
  );
}

// Each account gets its own query cache, so nothing one person loaded can show to the next who signs in on this browser.
function SignedIn() {
  const { userId } = useAuth();

  return <AccountQueries key={userId} />;
}

function AccountQueries() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));

  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
}

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "24px",
    padding: "24px",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
});
