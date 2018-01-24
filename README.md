# ngx-zxing
**Angular QR-Code scanner component**

[![NPM version](https://badge.fury.io/js/ngx-zxing.svg)](https://npmjs.org/package/ngx-zxing) [![Dependency Status](https://david-dm.org/werthdavid/ngx-zxing.svg)](https://david-dm.org/werthdavid/ngx-zxing) [![Build Status](https://secure.travis-ci.org/werthdavid/ngx-zxing.svg)](https://travis-ci.org/werthdavid/ngx-zxing) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com) [![Downloads](https://img.shields.io/npm/dm/ngx-zxing.svg)](https://npmjs.org/package/ngx-zxing)



### zxing
ZXing ("zebra crossing") is an open-source, multi-format 1D/2D barcode image processing library implemented in Java, with ports to other languages.

see: https://github.com/zxing/zxing

### zxing-typescript
zxing-typescript is a TypeScript-port of the ZXing library.

### ngx-typescript
This library wraps zxing-typescript into an Angular 2/4/5/X compatible component to scan QR-Codes the Angular-way.

## Features & Hints

* supports continuous scanning
* there is a delay of 1500ms after each successful scan, before a new QR-Code can be detected
* supports iOS 11
  * works only with Safari
  * works only if the page is delivered via HTTPS 

## Demo

* [StackBlitz](https://stackblitz.com/edit/ngx-zxing-example) _(preview needs to be openned in new window)_
* [Plunkr](https://plnkr.co/edit/U13ufJHexw2ugZbHx8kR?p=preview) _(preview needs to be openned in new window)_
* [Example](https://werthdavid.github.io/ngx-zxing/index.html)

## Installation

To install this library, run:

```bash
$ npm install ngx-zxing --save
```

and then from your Angular `AppModule`:

```typescript
import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { AppComponent } from './app.component';

// Import the library
import { NgxZxingModule } from 'ngx-zxing';
// Needed as well
import { FormsModule } from "@angular/forms";


@NgModule({
  declarations: [
    AppComponent
  ],
  imports: [
    BrowserModule,
    FormsModule,
    NgxZxingModule.forRoot()
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
```

## Usage

Once the library is imported, you can use it in your Angular application:

```xml
<ngx-zxing
    [start]="camStarted"
    [device]="selectedDevice"
    [cssClass]="small-video"
    (onCamsFound)="displayCameras($event)"
    (onScan)="handleQrCodeResult($event)"
></ngx-zxing>
```

* `start` used to start and stop the scanning (defaults to `false`)
* `device` is the video-device used for scanning (use one of the devices emitted by `onCamsFound`)
* `cssClass` this CSS-class name will be appended to the video-element e.g. for resizing it (see below)
* `onCamsFound` will emit an array of video-devices after view was initialized
* `onScan` will emit the result as string, after a valid QR-Code was scanned

### Change the size of the preview-element

In your CSS, define an extra class and pass it to the component with the `cssClass`-parameter.
CSS might look like this:

```css
.small-video {
    max-height: 70vh;
    width: 100vw;
    object-fit: contain;
}
```

## License

MIT © [David Werth](mailto:werth.david@gmail.com)
