---
title:       "FHEM-Adapter"
lastChanged: "21.09.2018"
editLink:    "https://github.com/ioBroker/ioBroker.fhem/blob/master/docs/de/README.md"
---)


!>Achtung!   
Seite ist im Aufbau!  
    
# <img src="media/fhem.png" width=150 hight=150/>&emsp;FHEM-Adapter
Der FHEM-Adapter ermöglicht die einfache Einbindung eines oder auch mehrerer FHEM Servern in ein ioBroker-System.

Alle Module aus FHEM können eingelesen, über ioBroker gesteuert und zur Visualisierung verwendet werden.

<!-- Einführungsbild-->
![{alt BildName}](media/titel.png "FHEM Oberfläche") <span style="color:grey">  
*FHEM Oberfläche*</span>



<details open><summary>Inhaltsverzeichnis</summary><p>

| Navigation                          |
|-------------------------------------|
| 1  [Steckbrief](#steckbrief)        |  
| 2  [Überblick](#überblick)          |
| 3  [Installation](#installation)    |
| 4  [Konfiguration](#konfiguration)  |
| 5  [Instanz](#instanz)              |
| 6  [Objekte](#objekte)              |
| 7  [Besonderheiten](#besonderheiten)|
| 8  [FAQ](#faq)                      |
| 9  [Beispiele](#beispiele)          |
| 10 [Deinstallation](#deinstallation)|
| 11 [Links](#links)                  |
| 12 [Historie](#historie)            |
</p></details>



<a name="steckbrief"/>

## Steckbrief
> Achtung! Die folgende Tabelle dient nur als Beispiel. Sie wird vom
  Dokumentengenerator dynamisch erzeugt und an dieser Stelle eingefügt.
  Je nach den ausgewählten Feldern sind die Datenquellen z.B. `frontmatter`,
  `io-package.json` und `package.json` des jeweilgen Adapters.

|                         |                              |
|-------------------------|:----------------------------:|
| Stand der Doku          | {date:}                      |
| aktuelle Version stable | ![stable][logo]              |
| aktuelle Version latest | ![latest][logo]              |
| OS                      | unterstützte OS              |
| node-Version            | unterstützte node-Versionen  |
| Entwickler              | Name/Alias des Entwicklers   |
| Github                  | https://github.com/ioBroker/ioBroker.fhem                    |
| Lizenz                  | MIT                          |
| Kategorie               | Iot-Systeme           |
| Keywords                | `iobroker` `fhem` `smarthome`                |
| Abhängigkeiten          | `dependencies`               |      



<a name="überblick"/>

## Überblick

### FHEM
FHEM bietet eine Vielzahl an Modulen mit diversen Protokollen.
Durch die Einbindung in ioBroker können alle FHEM Module in Verbindung mit sämtlichen Adaptern wie Alexa, VIS, Material usw genutzt werden.

### FHEM-Adapter
Nach erfolgreicher Verbindung zum FHEM Server werden alle Module automatisch eingelsen (jsonlist2)
Eine Möglichkeit zur Einschränkung der Module ist die Verwendung von `room = ioBroker` in FHEM.
Nach der Synchronisation mit FHEM werden alle Zustände / Änderungen und auch neue Module übertragen.

<a name="voraussetzungen"/>

## Voraussetzungen vor der Installation
Telnet in FHEM einrichten

<a name="installation"/>

## Installation

> Eine Instanz des Adapters wird über die ioBroker Admin-Oberfläche installiert.
  Die ausführliche Anleitung für die dazu notwendigen Installatonschritte ist
  **hier** beschrieben.


<a name="konfiguration"/>

##  Konfiguration
Die Adapterkonfiguration beschränkt sich auf Angaben zum FHEM Server und Telnet Schnittstelle.

<a name="{Eindeutiger Fensterbezeichner}"/>

![{alt-Name}](media/config.PNG "Adapterkonfiguration")<span style="color:grey">  
*Adapterkonfiguration*</span>

| Feld               | Beschreibung |                                                                       
|:-------------------|:-------------|
|**FHEM Telnet IP**|{Beschreibung}|
|**FHEM Telnet Port**|{Beschreibung}|
|**Kennwort**|{Beschreibung}|
|**Prompt**|{Beschreibung}|

Platz für besondere Hinweise.

> Nach Abschluß der Konfiguration wird der Konfigurationsdialog mit
  `SPEICHERN UND SCHLIEßEN` verlassen. Dadurch efolgt im Anschluß ein
  Neustart des Adapters.



<a name="instanz"/>

##  Instanzen
> Die Installation des Adapters hat im Bereich `Objekte` eine aktive Instanz des
  FHEM-Adapters angelegt.

![Instanz](media/instanz0.PNG "Instanz")<span style="color:grey">  
*Erste Instanz*</span>

Auf einem ioBroker Server können mehere Instanzen installiert werden.

> Ob der Adapter aktiviert oder mit FHEM verbunden ist,
  wird mit der Farbe des Status-Feldes der Instanz verdeutlicht. Zeigt der
  Mauszeiger auf das Symbol, werden weitere Detailinformationen dargestellt.



<a name="objekte"/>

## Objekte des Adapters

> Im Bereich `Objekte` werden in einer Baumstruktur alle vom Adapter in FHEM
  erkannten Gerätemodule und Hilfs (Erweiterungs-) Module alphabetisch aufgelistet.
  Falls im Modul das Attribut `alias` vorhanden ist wird es als `Name` des Objekts verwendet.
  Ist im Modul das Attribut `room` vorhanden wird es als `Raum` des Objekts verwendet.

![alt-Objektename](media/objekte1.PNG "Übersicht Objekte")<span style="color:grey">  
*Übersicht Objekte*</span>

> Die angelegten Objekte und ihre Bedeutungen sind wie folgt definiert:

Objekt                    | Zugriff | Bescheibung
:-------------------------|:-------:|:-----------
**fhem.0**                |  R  | Name der ersten *Instanz* des FHEM Adapters
&emsp;**A8**              |  R  | 1. Modul aus FHEM
&emsp;**A81**             |  R  | 2. Modul aus FHEM
&emsp;**:**               |  R  | x. Modul aus FHEM

### Objekte - einzelne Module aus FHEM
> Öffnet man ein Modul, so erhält man eine Liste mit allen zum Modul gehörenden Funktionalitäten

![alt-Objektename](media/objekte2.PNG "Übersicht Objekte-Modul")<span style="color:grey">  
*Übersicht Objekte-Modul*</span>

> Die angelegten Objekte und ihre Bedeutungen sind wie folgt definiert:

Objekt                    | Zugriff | Bescheibung
:-------------------------|:-------:|:-----------
**fhem.0**                        |  R  | Name der ersten *Instanz* des FHEM Adapters
&emsp;**HUEDevice1**              |  R  | Modul aus FHEM
&emsp;&emsp;**Attributes**        |  R  | Mögliche Attribute: alias, room, comment
&emsp;&emsp;**Internals**         |  R  | Mögliche Internals: NAME, TYPE, manufacturname, modellid, swversion
&emsp;&emsp;**alert**             |  RW  | Mögliche Internals: NAME, TYPE, manufacturname, modellid, swversion
&emsp;&emsp;**blink**             |  RW  | Mögliche Internals: NAME, TYPE, manufacturname, modellid, swversion
&emsp;&emsp;**:**                 |  R  | Mögliche Internals: NAME, TYPE, manufacturname, modellid, swversion
&emsp;&emsp;**:**                 |  RW  | Mögliche Internals: NAME, TYPE, manufacturname, modellid, swversion

#### {Weitere tiefergehende Erläuterungen zu einzelnen Objekten oder Funktionen}
Da der Platz für Beschreibungen in der Objekttabelle in der Regel nicht ausreichen
müssen hier z.B. einzelne Datenpunkte ausführlicher dokumentiert werden.

Beispiel für beschreibbare Datenpunkte:
#### Starten einer Aktivität
Aktivitäten werden gestartet, wenn man bei einer Aktivität
`{Instanz}.{Hub Name}.activities.{Aktivität}` eine Zahl größer als 0 einträgt.
Während der Ausführung der Aktivität ändert sich dieser Wert zuerst
nach 1 (=startend) und dann nach 2 (=aktiv).

### {Weitere tiefergehende Erläuterungen zu Objektgruppierungen}
Entsprechend dem Aufbau des Objektbaums und der Funktion des Adapters
hier individuelle Gestaltungsmöglichkeiten gegeben.

Beispiel für die Beschreibung einzelner Datenpunkte:
#### Statuswerte
`{Instanz}.{Hub Name}.activities.currentActivity` liefert die aktuell ausgeführte
Aktivität als Zeichenfolge.

`{Instanz}.{Hub Name}.activities.currentStatus` zeigt den Status des Harmony Hubs
an. Dabei bedeuten die Werte
- 0 = inaktiv
- 1 = startend
- 2 = aktiv






## Deinstallation
sollte die Instanz wieder entfernt werden sollen wird diese über das zugeordnete Mülleimer-Icon
in der Rubrik Instanzen entfernt

<img src="media/adapter_AdapterName_delete_01.png">

Es erscheint eine Sicherheitsabfrage, die mit ***OK*** bestätigt werden muss

<img src="media/adapter_AdapterName_delete_02.png">

Anschließend erscheint wieder ein Fenster, dass die Abarbeitung der Deinstallationsbefehle zeigt

<img src="media/adapter_AdapterName_delete_03.png">

Bei dieser Deinstallation werden alle zu der Instanz gehörenden Objekte vollständig entfernt.

Sollten die Installationsdateien vollständig von dem Host gelöscht werden, muss dies über das Mülleimer-Icon
in der Kachel des AdapterName-Adapters in der Rubrik Adapter geschehen.





## Beispiele/Demo
Lorem ipsum


## Besonderheiten
Backup
Multihost
History
Performance


## Bekannte Probleme

* nichts bekannt :-)


## Einbinden der States

### Blockly
Lorem ipsum

### Node-Red
Lorem ipsum

### vis
Lorem ipsum

### History
Lorem ipsum

<a name="links"/>

## Links

* ioBroker Forum / FHEM Adapter https://forum.iobroker.net/viewtopic.php?f=20&t=5387&start=200
* ioBroker Forum / FHEM Adapter https://forum.iobroker.net/viewtopic.php?f=20&t=5387&start=200

FHEM
* ioBroker Forum / FHEM Adapter https://forum.iobroker.net/viewtopic.php?f=20&t=5387&start=200
* ioBroker Forum / FHEM Adapter https://forum.iobroker.net/viewtopic.php?f=20&t=5387&start=200

## Entwicklerbereich
