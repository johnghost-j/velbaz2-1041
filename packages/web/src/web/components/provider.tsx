import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "../lib/theme";
import ErrorBoundary from "./ErrorBoundary";

const queryClient = new QueryClient();

interface ProviderProps {
  children: React.ReactNode;
}

/** Providers globaux de l'app (montés par app.tsx). */
export function Provider({ children }: ProviderProps) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>{children}</ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
