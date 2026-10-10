import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AuthProvider } from "./auth";
import { OrgProvider } from "./org";
import { Toaster, apiError, toast } from "./lib/toast";
import "./index.css";

// Any mutation that fails shows one error toast with the server's reason —
// success toasts are only ever shown from a mutation's onSuccess, so a failed
// action can never announce success. A mutation can add
// meta: { errorTitle: "Couldn't archive project" } for a clearer headline, or
// meta: { silent: true } when it reports its own failure.
const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      const meta = mutation.meta as { errorTitle?: string; silent?: boolean } | undefined;
      if (meta?.silent) return;
      const reason = apiError(error);
      if (meta?.errorTitle) toast.error(reason, { title: meta.errorTitle });
      else toast.error(reason);
    },
  }),
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <OrgProvider>
            <App />
            <Toaster />
          </OrgProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
