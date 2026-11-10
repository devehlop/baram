import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import type { Me } from './types';

export type Route =
  | { name: 'home' }
  | { name: 'search'; repeat?: boolean }
  | { name: 'trips' }
  | { name: 'booking'; id: number }
  | { name: 'help' }
  | { name: 'driver' }
  | { name: 'driverTrips' }
  | { name: 'driverTrip'; id: number }
  | { name: 'postTrip'; repeat?: boolean };

export interface Nav {
  me: Me;
  go(route: Route): void;
  back(): void;
  /** Начать с чистого листа: «В начало». */
  reset(route?: Route): void;
  reloadMe(): Promise<void>;
}

export const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('NavContext не задан');
  return nav;
}

/** Загрузка данных экрана. pollMs — тихое обновление (статусы поездки меняются без участия человека). */
export function useLoad<T>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const res = await api<T>(path);
      if (alive.current) {
        setData(res);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e instanceof ApiError ? e.code : 'network');
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    void reload();
    const timer = pollMs ? setInterval(() => void reload(), pollMs) : undefined;
    return () => {
      alive.current = false;
      if (timer) clearInterval(timer);
    };
  }, [reload, pollMs]);

  return { data, error, reload };
}

export const ERRORS: Record<string, string> = {
  network: 'Нет связи. Проверьте интернет и попробуйте ещё раз.',
  server_error: 'Что-то пошло не так. Попробуйте ещё раз.',
  unauthorized: 'Откройте приложение из чата с ботом «Барам».',
  blocked: 'Ваш аккаунт заблокирован. Свяжитесь с диспетчером.',
  not_found: 'Не найдено. Возможно, это уже неактуально.',
  not_available: 'Это действие уже недоступно.',
  no_seats: 'В этом рейсе уже нет столько мест. Выберите другой рейс.',
  own_trip: 'Это ваш собственный рейс.',
  duplicate: 'Этот пассажир уже записан в этот рейс.',
  bad_passenger: 'Проверьте имя и телефон пассажира.',
  bad_request: 'Проверьте, всё ли заполнено.',
  no_route: 'Между этими адресами рейсов нет.',
};

export const errorText = (code: string | null | undefined) => (code ? (ERRORS[code] ?? ERRORS.server_error!) : '');
