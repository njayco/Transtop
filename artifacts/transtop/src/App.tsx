import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { PrefsProvider } from '@/lib/prefs';
import { Shell } from '@/components/shell';
import { EntryGate } from '@/components/intro';
import Nearby from '@/pages/nearby';
import SearchPage from '@/pages/search';
import StopPage from '@/pages/stop';
import RoutePage from '@/pages/route';
import Favorites from '@/pages/favorites';
import RidePage from '@/pages/ride';
import Settings from '@/pages/settings';
import TrainPage from '@/pages/train';
import { TrainFollowsProvider } from '@/lib/train-follows';
import { PublicUrlMetadata } from '@/components/public-url-metadata';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, networkMode: 'online' } },
});

function Router() {
  return (
    <RoutedErrorBoundary>
      <PublicUrlMetadata />
      <Switch>
        <Route path="/" component={Nearby} />
        <Route path="/search" component={SearchPage} />
        <Route path="/stops/:id" component={StopPage} />
        <Route path="/routes/:id" component={RoutePage} />
        <Route path="/trains/:id" component={TrainPage} />
        <Route path="/favorites" component={Favorites} />
        <Route path="/ride" component={RidePage} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PrefsProvider>
        <TooltipProvider>
          <EntryGate>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <TrainFollowsProvider>
              <Shell>
                <Router />
              </Shell>
              </TrainFollowsProvider>
            </WouterRouter>
          </EntryGate>
          <Toaster />
        </TooltipProvider>
      </PrefsProvider>
    </QueryClientProvider>
  );
}

export default App;
