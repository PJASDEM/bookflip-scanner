# BookFlip Scanner

Prywatny wykonawca kolejki BookFlip. Strona steruje kolejką i trwale zapisuje wyniki. GitHub Actions pobiera zadania co godzinę (około 17. minuty; GitHub może opóźnić harmonogram). Uruchomienie ręczne jest dostępne w Actions → BookFlip Scanner → Run workflow. Nie jest potrzebna rozmowa z ChatGPT.

## Dostęp

Workflow ma tylko contents:read i id-token:write, bez zapisów do repozytorium. BookFlip sprawdza podpis OIDC, dokładne ID repozytorium i właściciela, main, ścieżkę workflow, rodzaj zdarzenia, czas ważności oraz audience. Pull requesty, forki i inne workflow nie mają dostępu. Prywatna brama Sites wymaga dodatkowo sekretu repozytorium BOOKFLIP_SITES_ACCESS z tokenem dostępu serwisowego tej konkretnej strony. Nie zapisuj go w plikach ani zmiennych workflow. Repozytorium nie zawiera kolekcji, historii użytkownika ani kluczy.

## Źródła

W BookFlip → Źródła i skanery edytuj źródło, wybierz „Dopuszczony feed JSON”, podaj publiczny URL HTTPS feedu bez sekretów i potwierdź uprawnienie do automatycznego odczytu. Feed to tablica lub {"offers":[...]}; rekord: {"title":"...","url":"https://...konkretna-oferta...","price":4500,"active":true,"observedAt":"2026-10-21T20:00:00Z"}. Kwoty: grosze PLN. Rekordy muszą być aktualne (24h), aktywne i pasować do tematu zadania. Dostęp do feedu nie potwierdza wydania ani pełnych kosztów nabycia.

Brak feedu jest widocznym SOURCE_NOT_CONFIGURED, nie pustym sukcesem. Nie zaimplementowano scrapera Vinted, OLX ani Allegro. Potrzebny jest dopuszczony dostęp/dostawca feedu. Nie ma rotacji proxy, omijania CAPTCHA ani ponawiania blokad. DNS i adresy feedu są walidowane i przypinane; brak przekierowań, limit 1 MB, 15 sekund.

## Koszty i limity

Pojedynczy przebieg ma limit 2 minut, pętla trwa do 75 sekund. Harmonogram godzinny to do ok. 1488 minut miesięcznie przy pełnym wykorzystaniu limitu w 31-dniowym miesiącu, plus ręczne uruchomienia. Nie skonfigurowano płatnych runnerów. Prywatne Actions korzystają z limitów konta GitHub, które trzeba kontrolować; ta konfiguracja nie włącza opłat ponad limit.

Etapy zakończone są zapisywane atomowo. Po błędach przejściowych obowiązuje backoff i maksymalnie 3 próby. Odmowa dostępu zatrzymuje etap. Błąd nie usuwa istniejących ofert. W logach są wyłącznie statusy i liczniki.
