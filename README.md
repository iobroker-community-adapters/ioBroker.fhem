![Logo](admin/fhem.png)
# ioBroker.fhem
=================

This adapter allows connect FHEM to ioBroker.

To enable the connection the telnet must be enabled in FHEM. To enable it (enabled by default) check following settings in fhen.cfg:

```define telnetPort telnet 7072 global```

Exactly same port and the IP address of FHEM host (or localhost if FHEM and ioBroker run on same PC) should be used for settings of adapter.

ioBroker sends at the start "jsonlist2" command to get all "Readings" from the list.

Write do not work at this moment.

## Changelog

#### 0.1.0
* (bluefox) initial release

## License
The MIT License (MIT)

Copyright (c) 2016 bluefox <dogafox@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
