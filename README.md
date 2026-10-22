# BookFlip Scanner

Prywatny wykonawca kolejki BookFlip. Strona steruje kolejką i trwale zapisuje wyniki. GitHub Actions pobiera zadania co godzinę (około 17. minuty; GitHub może opóźnić harmonogram). Uruchomienie ręczne jest dostępne w Actions → BookFlip Scanner → Run workflow. Nie jest potrzebna rozmowa z ChatGPT.

## Dostęp

Workflow ma tylko contents:read i id-token:write, bez zapisów do repozytorium. BookFlip sprawdza podpis OIDC, dokładne ID repozytorium i właściciela, main, ścieżkę workflow, rodzaj zdarzenia, czas ważności oraz audience. Pull requesty, forki i inne workflow nie mają dostępu. Prywatna brama Sites wymaga dodatkowo sekretu repozytorium BOOKFLIP_SITES_ACCESS z tokenem dostępu serwisowego tej konkretnej strony. Nie zapisuj go w plikach ani zmiennych workflow. Repozytorium nie zawiera kolekcji, historii użytkownika ani kluczy.

## Źródła

Na polecenie właściciela przeniesiono czytniki HTML Vinted, Allegro Lokalnie i OLX z `karno13/nextjs-boilerplate/archiwum-scanner/runtime/scanner.mjs` do osobnego `reference-parsers.mjs`. Skopiowano pięć funkcji rozpoznawania danych, bez transportu Vercel, katalogu, kolekcji, tokenów ani konfiguracji Archiwum. Matcher BookFlip obsługuje Discovery i tytuły Watchlist, w tym Warcraft. Czytnik OLX wymaga rozpoznanej struktury JSON-LD `offers.offers`; zmiana struktury jest błędem, a nie pustym sukcesem.

Transport jest osobny: stałe domeny, maksymalnie 20 kandydatów w pojedynczym zapisie, 18 sekund na odczyt, limit 4 MB, co najmniej 2 sekundy między żądaniami danego źródła. HTTP 403, 429 i CAPTCHA zatrzymują całe źródło, także pozostałe oczekujące zadania. Harmonogram pomija zatrzymane źródło. Ponowienie wymaga świadomego kliknięcia Skan Discovery lub Skan Watchlist na stronie. Nie ma proxy, zmiany adresów IP, sesji logowania ani obchodzenia mechanizmów ochrony. Awaria nie dezaktywuje istniejących ofert.

Vinted ma stronicowanie: nowy skan zaczyna od strony 1, a kolejne przebiegi wznawiają tę samą kolejkę ze strony i partii zapisanej w D1. Limit 20 dotyczy pojedynczej transakcji importu, a nie całej strony ani zapytania. Cała rozpoznana strona jest przetwarzana partiami. Dopiero ostatnia partia zatwierdza przejście do kolejnej strony. Postęp i oferty zapisują się atomowo; powtórzenie checkpointu nie powiela zapisu. Numer następnej strony wynika z metadanych lub poprawnego linku Vinted, nigdy z samej liczby wyników. Powtórzona strona i nierozpoznana paginacja kończą etap z oznaczeniem niepełnego zakresu. Znana ostatnia strona ma osobny status. Pozostałe czytniki nadal odczytują jedną stronę i maksymalnie 20 kandydatów.

Między stronami kolejka ustępuje innym zapytaniom. Próby po błędzie liczone są dla bieżącej strony. Budżet jednego przebiegu GitHub pozostaje ograniczony; niekompletna strona zachowuje zapisany offset, a wykonawca oddaje rezerwację przed zakończeniem. Po awarii odzyskiwana jest wygasła rezerwacja. Zmieniona strona jest czytana ponownie od początku z deduplikacją. Fingerprint ostatnich 100 stron zapobiega pętli; walidacja dopuszcza numery stron 1–10000. Zmiany kolejności ofert w portalu mogą powodować pominięcia i duplikaty, dlatego przejście wszystkich dostępnych stron nie jest gwarancją pełnego pokrycia rynku.

Wyniki HTML mają `provenance=marketplace_html`, cenę w groszach i `availability=unconfirmed`. Cena na liście wyników nie potwierdza dostępności ani ceny szczegółowej. Do wyceny potrzebne są ręczna kontrola oferty i pełne koszty. Nie podłączono głównego Allegro — adapter dotyczy Allegro Lokalnie, jak w Archiwum.

Podłączono publiczny kanał RSS/Atom Sprzedajemy.pl, udostępniony przez wydawcę na stronach wyszukiwania. Wykonawca odczytuje wyłącznie kanał, bez pobierania stron ogłoszeń. Importuje maksymalnie 20 pasujących wpisów z kategorii Książki i Podręczniki, odrzuca figurki i gry komputerowe. Cena jest ceną z kanału, a dostępność pozostaje niepotwierdzona. Data odczytu kanału i data aktualizacji wpisu są oddzielne. Pusty poprawny kanał oznacza brak pasujących wpisów w tym zakresie, nie brak ofert w całym serwisie.

Każdy przebieg tworzy kolejny skan Discovery oraz Watchlist, jeżeli poprzednia kolejka została zakończona. Harmonogram można wstrzymać i wznowić na stronie. Wstrzymanie anuluje oczekujące zadania; ręczne skany są nadal dostępne.

W BookFlip → Źródła i skanery edytuj źródło, wybierz „Dopuszczony feed JSON”, podaj publiczny URL HTTPS feedu bez sekretów i potwierdź uprawnienie do automatycznego odczytu. Feed to tablica lub {"offers":[...]}; rekord: {"title":"...","url":"https://...konkretna-oferta...","price":4500,"active":true,"observedAt":"2026-10-21T20:00:00Z"}. Kwoty: grosze PLN. Rekordy muszą być aktualne (24h), aktywne i pasować do tematu zadania. Dostęp do feedu nie potwierdza wydania ani pełnych kosztów nabycia.

Opcjonalny autoryzowany feed JSON zastępuje czytnik HTML danego portalu. DNS i adresy feedu są walidowane i przypinane; brak przekierowań, limit 1 MB, 15 sekund.

## Koszty i limity

Pojedynczy przebieg ma limit 2 minut, pętla trwa do 75 sekund. Harmonogram godzinny to do ok. 1488 minut miesięcznie przy pełnym wykorzystaniu limitu w 31-dniowym miesiącu, plus ręczne uruchomienia. Nie skonfigurowano płatnych runnerów. Prywatne Actions korzystają z limitów konta GitHub, które trzeba kontrolować; ta konfiguracja nie włącza opłat ponad limit.

Etapy zakończone są zapisywane atomowo. Po błędach przejściowych obowiązuje backoff i maksymalnie 3 próby. Odmowa dostępu zatrzymuje etap. Błąd nie usuwa istniejących ofert. W logach są wyłącznie statusy i liczniki.
