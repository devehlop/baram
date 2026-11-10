import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from './api';
import { Button, ErrorNote, Loading } from './components';
import { errorText, NavContext, type Nav, type Route } from './nav';
import { Booking } from './screens/Booking';
import { DriverHomeScreen, DriverTripScreen, DriverTripsScreen, PostTripScreen } from './screens/Driver';
import { Help, Home, MyTrips, Onboarding } from './screens/Passenger';
import { SearchFlow } from './screens/SearchFlow';
import { tg } from './tg';
import type { Me } from './types';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);

  const reloadMe = useCallback(async () => {
    try {
      setMe(await api<Me>('/me'));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'network');
    }
  }, []);

  useEffect(() => {
    void reloadMe();
  }, [reloadMe]);

  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);

  // Системная кнопка «Назад» Telegram — в дополнение к нашей (DESIGN.md §8).
  const canGoBack = stack.length > 1;
  useEffect(() => {
    const btn = tg?.BackButton;
    if (!btn) return;
    try {
      if (canGoBack) btn.show();
      else btn.hide();
      btn.onClick(back);
      return () => btn.offClick(back);
    } catch {
      return;
    }
  }, [canGoBack, back]);

  const home: Route = me?.user?.activeRole === 'driver' && me.driver ? { name: 'driver' } : { name: 'home' };

  const nav = useMemo<Nav | null>(
    () =>
      me && {
        me,
        go: (route) => setStack((s) => [...s, route]),
        back,
        reset: (route) => setStack(route ? [{ name: 'home' }, route] : [{ name: 'home' }]),
        reloadMe,
      },
    [me, back, reloadMe],
  );

  if (error && !me) {
    return (
      <div className="screen">
        <div className="loading">
          <ErrorNote>{errorText(error)}</ErrorNote>
          <Button onClick={() => void reloadMe()}>Попробовать ещё раз</Button>
        </div>
      </div>
    );
  }
  if (!me || !nav) return <Loading />;
  if (!me.registered) return <Onboarding />;

  const top = stack[stack.length - 1]!;
  const route: Route = top.name === 'home' ? home : top;

  return (
    <NavContext.Provider value={nav}>
      {route.name === 'home' && <Home />}
      {route.name === 'search' && <SearchFlow repeat={route.repeat} />}
      {route.name === 'trips' && <MyTrips />}
      {route.name === 'booking' && <Booking id={route.id} />}
      {route.name === 'help' && <Help />}
      {route.name === 'driver' && <DriverHomeScreen />}
      {route.name === 'driverTrips' && <DriverTripsScreen />}
      {route.name === 'driverTrip' && <DriverTripScreen id={route.id} />}
      {route.name === 'postTrip' && <PostTripScreen repeat={route.repeat} />}
    </NavContext.Provider>
  );
}
