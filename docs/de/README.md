---
title:       "FHEM-Adapter"
lastChanged: "22.09.2018"
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
| 6  [Objekte des Adapters](#objekte)           |
| 6.1 [Modul aus FHEM Typ:channel](#objekte_c)  |
| 6.2 [Objekt info](#objekte_i)            |
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
Durch die Einbindung in ioBroker können alle FHEM Module in Verbindung mit sämtlichen ioBroker-Adaptern wie Alexa, VIS, Material usw genutzt werden.

### FHEM-Adapter
Nach erfolgreicher Verbindung zum FHEM Server werden alle Module automatisch eingelsen (jsonlist2)
Eine Möglichkeit zur Einschränkung der eingelesenen Module ist die Verwendung von einem Raum `room = ioBroker` in FHEM.
Nach der Synchronisation mit FHEM werden alle Zustände / Änderungen und auch neue Module übertragen.

<a name="voraussetzungen"/>

## Voraussetzungen vor der Installation
> Bei der Installation FHEM-Server wird ein telnet-Modul mit Namen `telnetPort` automatisch angelegt.

Der FHEM Befehl `list telnetPort` sollte deshalb folgendes Ergebnis bringen:

![{alt-Name}](media/telnet1.PNG "FHEM telnetPort")<span style="color:grey">  
*FHEM telnetPort*</span>

Falls nicht vorhanden, mit FHEM Befehl `define telnetPort telnet 7072 global` anlegen.


> Zusätlich kann noch ein Passwort für die Telnet Verbindung gesetzt werden.

Der FHEM Befehl `list allowed_telnetPort` sollte folgendes Ergebnis bringen:

![{alt-Name}](media/telnet2.PNG "FHEM telnetPort Passwort")<span style="color:grey">  
*FHEM telnetPort Passwort*</span>

Falls nicht vorhanden oder unvollständig, mit folgenden Befehlen anlegen/ergänzen/ändern: 

* `define allowed_telnetPort allowed` Anlage allowed-Modul mit Name allowed_telnetPort
* `attr allowed_telnetPort validFor telnetPort` Zuordnung telnet-Modul Name telnetPort
* `set allowed_telnetPort password <passwort>` Passwort setzen


> Zum Abschluß ist ein Test der Verbindung mit zB PuTTY zu empfehlen! (Download unter [Links](#links)) 

![{alt-Name}](media/putty1.PNG "Putty1")<span style="color:grey">  
*Putty1*</span>

![{alt-Name}](media/putty2.PNG "Putty2")<span style="color:grey">  
*Putty Passwort*</span>

* Eingabe Passwort und 2 * Return!

![{alt-Name}](media/putty3.PNG "Putty3")<span style="color:grey">  
*Putty Prompt*</span>

* `jsonlist2` FHEM Module
* `inform on` FHEM events 


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
|**FHEM Telnet IP**|iobBroker/FHEM auf 1 Server (local)127.0.0.1, sonst IP FHEM Server                       |
|**FHEM Telnet Port**|Standard: 7072 oder Wert aus FHEM Modul telnetPort Internals:PORT              |                                                           
|**Kennwort**|Option: Wurde mit set allowed_telnetPort password `<passwort>` gesetzt                                                      |
|**Prompt**|Standard: fhem> oder Wert aus attr telnetPort prompt xxx + > oder Wert aus attr global title xxx + >        |

Alle Angaben beziehen sich auf bei der FHEM Installation automatisch angelegte Modul `telnetPort`

> Nach Abschluß der Konfiguration wird der Konfigurationsdialog mit
  `SPEICHERN UND SCHLIEßEN` verlassen. Dadurch efolgt im Anschluß ein
  Neustart des Adapters.



<a name="instanz"/>

##  Instanzen
> Die Installation des Adapters hat in der ioBroker Admin-Oberfläche Bereich `Instanzen` eine aktive Instanz des
  FHEM-Adapters angelegt.

![Instanz](media/instanz0.PNG "Instanz")<span style="color:grey">  
*Erste Instanz*</span>

Auf einem ioBroker Server können mehere Instanzen installiert werden.

> Ob der Adapter aktiviert oder mit FHEM verbunden ist,
  wird mit der Farbe des Status-Feldes der Instanz verdeutlicht. Zeigt der
  Mauszeiger auf das Symbol, werden weitere Detailinformationen dargestellt.



<a name="objekte"/>

## Objekte des Adapters

> In der ioBroker Admin-OberflächeIm Bereich `Objekte` werden in einer Baumstruktur alle vom Adapter in FHEM
  erkannten Gerätemodule und Hilfs (Erweiterungs-) Module alphabetisch aufgelistet.
  Falls im Modul das Attribut `alias` vorhanden ist wird es als `Name` des Objekts verwendet.
  Ist im Modul das Attribut `room` vorhanden wird es als `Raum` des Objekts verwendet.

![alt-Objektename](media/objekte1.PNG "Übersicht Objekte")<span style="color:grey">  
*Übersicht Objekte*</span>

> Die angelegten Objekte und ihre Bedeutungen sind wie folgt definiert:

Objekt                    | Zugriff | Bescheibung
:-------------------------|:-------:|:-----------
**fhem.0**                   |  R  | Name der ersten *Instanz* des FHEM Adapters
&emsp;**A8**                 |  R  | 1. Modul aus FHEM
&emsp;**A81**                |  R  | 2. Modul aus FHEM
&emsp;**:**                  |  R  | x. Modul aus FHEM
&emsp;**[info](#objekte_i)** |  R  | Information und mehr


<a name="objekte_c"/>

### Modul aus FHEM Typ:channel
> Öffnet man ein Modul (channel), so erhält man eine Liste mit allen zum Modul gehörenden Funktionalitäten

![alt-Objektename](media/objekte2.PNG "Übersicht Objekte-Modul")<span style="color:grey">  
*Übersicht Objekte-Modul*</span>

> Die angelegten Objekte und ihre Bedeutungen sind wie folgt definiert:

Objekt                    | Zugriff | Bescheibung
:-------------------------|:-------:|:-----------
**[fhem.o](#objekte)**                     |  R  | Name der ersten *Instanz* des FHEM Adapters
&emsp;**HUEDevice1**                       |  R  | Modul aus FHEM
&emsp;&emsp;**[Attributes](#objekte_c_a)** |  R  | 
&emsp;&emsp;**[Internals](#objekte_c_i)**  |  R  | 
&emsp;&emsp;**alert**                      |  RW | 
&emsp;&emsp;**blink**                      |  RW | 
&emsp;&emsp;**:**                          |  R  | 
&emsp;&emsp;**:**                          |  RW | 

<a name="objekte_c_a"/>

#### Attributes
> Attributes werden aus FHEM ausgelesen und können über ioBroker auch geändert werden.

![alt-Objektename](media/objekte2attributes.PNG "Objekte-Attributes")<span style="color:grey">  
*Objekte-Attributes*</span>

> Die angelegten Objekte und ihre Bedeutungen sind wie folgt definiert:

Objekt                    | Zugriff | Bescheibung
:-------------------------|:-------:|:-----------
**[fhem.o](#objekte)**                     |  R  | Name der ersten *Instanz* des FHEM Adapters
&emsp;**[HUEDevice1](#objekte_c)**         |  R  | 
&emsp;&emsp;**Attributes**        |  R  | Mögliche Attribute: alias, room, disable, comment
&emsp;&emsp;&emsp;**alias**       |  RW | alias = Name Objekt + Übertrag in FHEM
&emsp;&emsp;&emsp;**room**        |  RW | room = Raum Objekt + Übertrag in FHEM

<a name="objekte_c_i"/>

#### Internals
> Internals werden aus FHEM ausgelesen und sind nur als Info zB Anzeige in VIS gedacht.

![alt-Objektename](media/objekte2internals.PNG "Objekte-Internals")<span style="color:grey">  
*Objekte-Internals*</span>

> Die angelegten Objekte und ihre Bedeutungen sind wie folgt definiert:

Objekt                    | Zugriff | Bescheibung
:-------------------------|:-------:|:-----------
**[fhem.o](#objekte)**                     |  R  | Name der ersten *Instanz* des FHEM Adapters
&emsp;**[HUEDevice1](#objekte_c)**         |  R  | 
&emsp;&emsp;**[Attributes](#objekte_c_a)**              |  R  | Mögliche Attribute: alias, room, disable, comment
&emsp;&emsp;**Internals**               |  R  | Mögliche Internals: NAME, TYPE, manufacturname, modellid, swversion
&emsp;&emsp;&emsp;**NAME**              |  R  | Info zB zur Anzeige in VIS
&emsp;&emsp;&emsp;**TYPE**              |  R  | Info zB zur Anzeige in VIS
&emsp;&emsp;&emsp;**manufacturname**    |  R  | Info zB zur Anzeige in VIS
&emsp;&emsp;&emsp;**modellid**          |  R  | Info zB zur Anzeige in VIS
&emsp;&emsp;&emsp;**swversion**         |  R  | Info zB zur Anzeige in VIS

<a name="objekte_i"/>

## Objekt info
> Öffnet man das Objekt info, so erhält man eine Liste mit allen weiteren Funktionalitäten und Informationen. Es ist nicht möglich ein Modul mit dem Namen info aus FHEM zu übernehmen.

![alt-Objektename](media/objekte3info.PNG "Übersicht info")<span style="color:grey">  
*Übersicht info*</span>

> Die angelegten Objekte und ihre Bedeutungen sind wie folgt definiert:

Objekt                    | Zugriff | Bescheibung
:-------------------------|:-------:|:-----------
**[fhem.o](#objekte)**                                 |  R  | Name der ersten *Instanz* des FHEM Adapters
&emsp;**info**                                         |  R  | Information und mehr
&emsp;&emsp;**[Commands](#info_commands)**             |  R  | 
&emsp;&emsp;**[Configurations](#info_configurations)** |  R  | 
&emsp;&emsp;**[Info](#info_info)**                     |  R  |
&emsp;&emsp;**[Settings](#info_settings)**             |  R  | 
&emsp;&emsp;**connection**                             |  R  | Status Verbindung zu FHEM true/false
&emsp;&emsp;**resync**                                 |  RW | im Moment nicht möglich :-(

<a name="info_commands"/>

#### Commands

> Unter Commands ist es möglich einen beliebigen Befehl an FHEM zu senden.

![alt-Objektename](media/objekte3infoCommands.PNG "Objekte-Attributes")<span style="color:grey">  
*Objekte-Attributes*</span>

> Die angelegten Objekte und ihre Bedeutungen sind wie folgt definiert:

Objekt                    | Zugriff | Bescheibung
:-------------------------|:-------:|:-----------
**[fhem.o](#objekte)**                     |  R  | Name der ersten *Instanz* des FHEM Adapters
&emsp;**[info](#objekte_i)**      |  R  | Information und mehr
&emsp;&emsp;**Commands**          |  R  | Commands
&emsp;&emsp;&emsp;**lastCommand** |  R  | Letzer Befehl von ioBroker an FHEM
&emsp;&emsp;&emsp;**resultFHEM**  |  R  | Liefert Ergebnis von sendFHEM
&emsp;&emsp;&emsp;**sendFHEM**    |  RW | Entspricht Befehlszeile in FHEM zB update check

<a name="info_configurations"/>

#### Configurations

> Unter Configurations können verschiedene Funktionen aktiviert/deaktiviert werden. Bei Änderungen ist ein Neustart des FHEM Adaptes notwendig.

![alt-Objektename](media/objekte3infoConfiguratios.PNG "Objekte-Attributes")<span style="color:grey">  
*Objekte-Attributes*</span>

> Die angelegten Objekte und ihre Bedeutungen sind wie folgt definiert:

Objekt                             | Zugriff | Bescheibung
:----------------------------------|:-------:|:-----------
**[fhem.o](#objekte)**                      |  R  | Name der ersten *Instanz* des FHEM Adapters
&emsp;**[info](#objekte_i)**                |  R  | Information und mehr
&emsp;&emsp;**[Commands](#info_commands)** |  R  |
&emsp;&emsp;**Configurations**     |  R  | Configurations
&emsp;&emsp;&emsp;**autoFunction** |  RW | (true) Funktionen werden bei Neustart nach Stand Adapter vergeben  (false) Funktionn werden nur beim 1.Start Adapter vergeben
&emsp;&emsp;&emsp;**autoRole**     |  RW | (true) Rollen werden bei Neustart nach Stand Adaper vergeben  (false) Rollen werden nur beim 1.Start Adapter vergeben

<a name="info_info"/>

#### Info

> Unter Info sind verschiedene Parameter aus der Synchronisation sichtbar.

![alt-Objektename](media/objekte3infoInfo.PNG "Objekte-Attributes")<span style="color:grey">  
*Objekte-Attributes*</span>

> Die angelegten Objekte und ihre Bedeutungen sind wie folgt definiert:

Objekt                    | Zugriff | Bescheibung
:-------------------------|:-------:|:-----------
**[fhem.o](#objekte)**                                  |  R  | Name der ersten *Instanz* des FHEM Adapters
&emsp;**[info](#objekte_i)**                            |  R  | 
&emsp;&emsp;**[Commands](#info_commands)**              |  R  | 
&emsp;&emsp;**[Configurations](#info_configurations)**  |  R  | 
&emsp;&emsp;**Info**                |  R  | Info
&emsp;&emsp;&emsp;**NumberObjects** |  R  | Anzahl Module in FHEM
&emsp;&emsp;&emsp;**roomioBroker**  |  R  | (true) Raum ioBroker in FHEM vorhanden

<a name="info_settings"/>

#### Settings

> Unter Settings können bestimmte Einträge für die ioBroker Admin-Oberfläche Bereich `Log` ausgewählt werden. Bei Änderungen ist kein Neustart FHEM-Adapter notwendig.

![alt-Objektename](media/objekte3infoSettings.PNG "Objekte-Attributes")<span style="color:grey">  
*Objekte-Attributes*</span>

> Die angelegten Objekte und ihre Bedeutungen sind wie folgt definiert:

Objekt                    | Zugriff | Bescheibung
:-------------------------|:-------:|:-----------
**[fhem.o](#objekte)**                                 |  R  | Name der ersten *Instanz* des FHEM Adapters
&emsp;**[info](#objekte_i)**                           |  R  | Information und mehr
&emsp;&emsp;**[Commands](#info_commands)**             |  R  | 
&emsp;&emsp;**[Configurations](#info_configurations)** |  R  | 
&emsp;&emsp;**[Info](#info_info)**                     |  R  | 
&emsp;&emsp;**Settings**                               |  R  | Settings
&emsp;&emsp;&emsp;**logCheckObject**         |  RW | (true) Erzeugt info check cannel im LOG
&emsp;&emsp;&emsp;**logCreateChannel**       |  RW | (true) Erzeugt info Create channel im LOG
&emsp;&emsp;&emsp;**logDeleteChannel**       |  RW | (true) Erzeugt info Delete channel im LOG
&emsp;&emsp;&emsp;**logEventFHEM**           |  RW | (true) Erzeugt info eventFHEM im LOG
&emsp;&emsp;&emsp;**logEventFHEMglobal**     |  RW | (true) Erzeugt info eventFHEM(g) im LOG
&emsp;&emsp;&emsp;**logEventFHEMreading**    |  RW | (true) Erzeugt info eventFHEM(r) im LOG
&emsp;&emsp;&emsp;**logEventFHEMstate**      |  RW | (true) Erzeugt info eventFHEM(s) im LOG
&emsp;&emsp;&emsp;**logEventIOB**            |  RW | (true) Erzeugt info eventIOB im LOG
&emsp;&emsp;&emsp;**logUnhandeledEventFHEM** |  RW | (true) Erzeugt warn unhandeled event FHEM im LOG
&emsp;&emsp;&emsp;**logUpdateChannel**       |  RW | (true) Erzeugt info Update channel im LOG

<a name="besonderheiten"/>

## Besonderheiten

> Zusätzliche Funktionen dieses Adapter

### Objekt zugeordnete Rolle
> Rollen

> Die angelegten Objekte und ihre Bedeutungen sind wie folgt definiert:

Rolle                    | Objekt state | Zugriff | Art | min Wert | max Wert | Einheit |
:------------------------|:------------:|:-------:|:---:|:--------:|:--------:|:---------  
level.volume             | volume      | RW | Zahl  |  0  | 100 | %  
                         | Volume      |  
level.volume.group       | GroupVolume           | RW | Zahl  |  0  | 100 | %
level.dimmer             | pct, brightness, dim  | RW | Zahl  |  0  | 100 | %
level.color.temperature  | color                 | RW | Zahl  |
level.color.rgb          | rgb                   | RW | Text  |
level.color.saturation   | sat                   | RW |       |
level.temperature        | desired-temp          | RW | Zahl  |
indicator.unreach        | present               | R  | Logik |
indicator.reachable      |                       | R  | Logik |
value.temperature        |                       | R  | Zahl |
switch                   |                       | R  | Logik |



 
### Objekt zugeordnete Funktion
> Funktionen

> Die angelegten Objekte und ihre Bedeutungen sind wie folgt definiert:

Funktion                    | TYPE  | Rolle
:------------------------|:----------:|:-----------
switch                   |    | switch
temperature              |    | value.temperature
audio                    |  SONOSPLAYER  |
security                 |    |
light                    |  HUEDEVICE  |
heating                  |    |

<a name="faq"/>

## FAQ

> In meiner IoBroker Installation werden nicht alle Module aus FHEM synchronisiert

Ist in FHEM ein Raum ioBroker vorhanden?

> Abweichungen diese Doku zu meinem ioBroker System

Aktuellle Version der FHEM Adapters installiert?

<a name="beispiele"/>

## Beispiele/Demo
Lorem ipsum


<a name="deinstallation"/>

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

<a name="links"/>

## Links

FHEM-Adapter
* ioBroker Forum / FHEM Adapter https://forum.iobroker.net/viewtopic.php?f=20&t=5387&start=200
* ioBroker-Tutorial Part 9: Verknüpfung mit FHEM | haus-automatisierung.com https://youtu.be/6jwlxGqt5TU

Tools
* Download Putty https://www.putty.org/

FHEM
* FHEMs Einstiegsseite https://fhem.de/fhem_DE.html
* FHEM Forum           https://forum.fhem.de/

## Entwicklerbereich
* github ioBroker.fhem https://github.com/ioBroker/ioBroker.fhem

<a name=historie/> 

## Historie
