import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    EventEmitter,
    Inject,
    Input,
    OnChanges,
    OnDestroy,
    Output,
    PLATFORM_ID,
    SimpleChanges,
    ViewChild
} from '@angular/core';

import { isPlatformBrowser } from '@angular/common';

import { Result, MultiFormatReader, DecodeHintType } from '@zxing/library';
import BarcodeFormat from '@zxing/library/src/core/BarcodeFormat';

import { BrowserQRCodeReader } from './browser-qr-code-reader';
import { BrowserCodeReader } from './browser-code-reader';
import { CodeTypes } from './code-types';

@Component({
    // tslint:disable-next-line:component-selector
    selector: 'zxing-scanner',
    templateUrl: './zxing-scanner.component.html',
    styleUrls: ['./zxing-scanner.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ZXingScannerComponent implements AfterViewInit, OnDestroy, OnChanges {

    /**
     * The ZXing code reader.
     */
    private codeReader: BrowserCodeReader;

    /**
     * Has `navigator` access.
     */
    private hasNavigator: boolean;


    /**
     * Says if some native API is supported.
     */
    private isMediaDevicesSuported: boolean;

    /**
     * Says if some native API is supported.
     */
    private isEnumerateDevicesSuported: boolean;

    /**
     * List of enable video-input devices.
     */
    private videoInputDevices: MediaDeviceInfo[];
    /**
     * The actual device used to scan things.
     */
    private videoInputDevice: MediaDeviceInfo;

    /**
     * Says if the user allowedthe use of the camera or not.
     */
    private hasPermission: boolean;

    /**
     * Reference to the preview element, should be the `video` tag.
     */
    @ViewChild('preview')
    previewElemRef: ElementRef;

    /**
     * Codes types to scan
     */
    @Input()
    codeTypes: CodeTypes | CodeTypes[] = "qr";

    /**
     * The scan throttling (time between scans) in milliseconds.
     */
    @Input()
    scanThrottling = 1500;

    /**
     * Allow start scan or not.
     */
    @Input()
    scannerEnabled = true;

    /**
     * The device that should be used to scan things.
     */
    @Input()
    device: MediaDeviceInfo;

    /**
     * The value of the HTML video's class attribute.
     */
    @Input()
    cssClass: string;

    /**
     * Enable or disable autofocus of the camera (might have an impact on performance)
     */
    @Input()
    autofocusEnabled = true;

    /**
     * Allow start scan or not.
     */
    @Input()
    set torch(on: boolean) {
        this.codeReader.setTorch(on);
    }

    /**
     * Emitts events when the torch compatibility is changed.
     */
    @Output()
    torchCompatible = new EventEmitter<boolean>();

    /**
     * Emitts events when a scan is successful performed, will inject the string value of the QR-code to the callback.
     */
    @Output()
    scanSuccess = new EventEmitter<string>();

    /**
     * Emitts events when a scan fails without errors, usefull to know how much scan tries where made.
     */
    @Output()
    scanFailure = new EventEmitter<void>();

    /**
     * Emitts events when a scan throws some error, will inject the error to the callback.
     */
    @Output()
    scanError = new EventEmitter<Error>();

    /**
     * Emitts events when a scan is performed, will inject the Result value of the QR-code scan (if available) to the callback.
     */
    @Output()
    scanComplete = new EventEmitter<Result>();

    /**
     * Emitts events when no cameras are found, will inject an exception (if available) to the callback.
     */
    @Output()
    camerasFound = new EventEmitter<MediaDeviceInfo[]>();

    /**
     * Emitts events when no cameras are found, will inject an exception (if available) to the callback.
     */
    @Output()
    camerasNotFound = new EventEmitter<any>();

    /**
     * Emitts events when the users answers for permission.
     */
    @Output()
    permissionResponse = new EventEmitter<boolean>();

    /**
     * Constructor to build the object and do some DI.
     */
    constructor() {
        this.codeReader = new BrowserQRCodeReader(1500);
        this.hasNavigator = typeof navigator !== 'undefined';
        this.isMediaDevicesSuported = this.hasNavigator && !!navigator.mediaDevices;
        this.isEnumerateDevicesSuported = !!(this.isMediaDevicesSuported && navigator.mediaDevices.enumerateDevices);
    }

    /**
     * Manages the bindinded property changes.
     * @param changes
     */
    ngOnChanges(changes: SimpleChanges): void {

        if (changes.scannerEnabled) {
            if (!this.scannerEnabled) {
                this.resetScan();
            } else if (this.videoInputDevice) {
                this.scan(this.videoInputDevice.deviceId);
            }
        }

        if (changes.device) {
            if (this.device) {
                this.changeDevice(this.device);
            } else {
                console.warn('zxing-scanner', 'device', 'Unselected device.');
                this.resetScan();
            }
        }

        if (changes.scanThrottling && !changes.codeTypes) {
            this.setCodeReaderThrottling(this.scanThrottling);
        }

        if (changes.codeTypes) {
            this.setCodeTypes(this.codeTypes);
        }
    }

    /**
     * Executed after the view initialization.
     */
    ngAfterViewInit(): void {

        // Chrome 63 fix
        if (!this.previewElemRef) {
            console.warn('zxing-scanner', 'Preview element not found!');
            return;
        }

        // iOS 11 Fix
        this.previewElemRef.nativeElement.setAttribute('autoplay', false);
        this.previewElemRef.nativeElement.setAttribute('muted', true);
        this.previewElemRef.nativeElement.setAttribute('playsinline', true);
        this.previewElemRef.nativeElement.setAttribute('autofocus', this.autofocusEnabled);

        this.askForPermission().subscribe((hasPermission: boolean) => {

            if (hasPermission) {

                // gets and enumerates all video devices
                this.enumarateVideoDevices((videoInputDevices: MediaDeviceInfo[]) => {

                    if (videoInputDevices && videoInputDevices.length > 0) {
                        this.camerasFound.next(videoInputDevices);
                    } else {
                        this.camerasNotFound.next();
                    }

                });

                this.startScan(this.videoInputDevice);

                this.codeReader.torchAvailable.subscribe((value: boolean) => {
                    this.torchCompatible.emit(value);
                });

            } else {

                if (hasPermission === false) {
                    console.warn('zxing-scanner', 'ngAfterViewInit', 'User has denied permission.');
                } else {
                    console.warn('zxing-scanner', 'ngAfterViewInit', 'It was not possible to check for permissions.');
                }
            }

        });
    }

    /**
     * Executes some actions before destroy the component.
     */
    ngOnDestroy(): void {
        this.resetScan();
    }

    /**
     * Starts a new QR-scanner to set a new scan throttling.
     *
     * @param throttling The scan speed in milliseconds.
     */
    setCodeReaderThrottling(throttling: number): void {
        this.scanThrottling = throttling;
        this.codeReader = new BrowserQRCodeReader(throttling);
        this.restartScan();
    }

    /**
     * Changes the supported code times.
     * @param types The type or an arry of types to support.
     */
    setCodeTypes(types: CodeTypes | CodeTypes[]): void {
        this.codeTypes = types;
        if (typeof types === "string")
            types = [types];
        if (types.indexOf("any") >= 0)
            this.codeReader = new BrowserCodeReader(new MultiFormatReader(), this.scanThrottling);
        else {
            const typeMap: { [index in CodeTypes]?: BarcodeFormat[] } = {
                oned: [
                    BarcodeFormat.UPC_A,
                    BarcodeFormat.UPC_E,
                    BarcodeFormat.EAN_13,
                    BarcodeFormat.EAN_8,
                    BarcodeFormat.CODABAR,
                    BarcodeFormat.CODE_39,
                    BarcodeFormat.CODE_93,
                    BarcodeFormat.CODE_128,
                    BarcodeFormat.ITF,
                    BarcodeFormat.RSS_14,
                    BarcodeFormat.RSS_EXPANDED
                ],
                code128: [BarcodeFormat.CODE_128],
                ean: [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8],
                itf: [BarcodeFormat.ITF],
                qr: [BarcodeFormat.QR_CODE],
                datamatrix: [ BarcodeFormat.DATA_MATRIX]
            };

            let formats = types.map(t => typeMap[t]);
            const multi = new MultiFormatReader();
            const hints = new Map<DecodeHintType, any>();
            hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
            multi.setHints(hints);
            this.codeReader = new BrowserCodeReader(multi, this.scanThrottling);
        }
        this.restartScan();
    }

    /**
     * Properly changes the actual target device.
     *
     * @param device
     */
    changeDevice(device: MediaDeviceInfo): void {
        this.videoInputDevice = device;
        this.startScan(device);
    }

    /**
     * Properly changes the actual target device using it's deviceId.
     *
     * @param deviceId
     */
    changeDeviceById(deviceId: string): void {
        this.changeDevice(this.getDeviceById(deviceId));
    }

    /**
     * Properly returns the target device using it's deviceId.
     *
     * @param deviceId
     */
    getDeviceById(deviceId: string): MediaDeviceInfo {
        return this.videoInputDevices.find(device => device.deviceId === deviceId);
    }

    /**
     * Sets the permission value and emmits the event.
     */
    private setPermission(hasPermission: boolean | undefined): EventEmitter<boolean> {
        this.hasPermission = hasPermission;
        this.permissionResponse.next(hasPermission);
        return this.permissionResponse;
    }

    /**
     * Gets and registers all cammeras.
     */
    askForPermission(): EventEmitter<boolean> {

        if (!this.hasNavigator) {
            console.error('zxing-scanner', 'askForPermission', 'Can\'t ask permission, navigator is not present.');
            return this.setPermission(undefined);
        }

        if (!this.isMediaDevicesSuported) {
            console.error('zxing-scanner', 'askForPermission', 'Can\'t get user media, this is not supported.');
            return this.setPermission(undefined);
        }

        // Will try to ask for permission
        navigator
            .mediaDevices
            .getUserMedia({ audio: false, video: true })
            .then((stream: MediaStream) => {

                try {

                    // Start stream so Browser can display its permission-dialog
                    this.codeReader.bindVideoSrc(this.previewElemRef.nativeElement, stream);

                    // After permission was granted, we can stop it again
                    stream.getVideoTracks().forEach(track => {
                        track.stop();
                    });

                    // should stop the opened stream
                    this.codeReader.unbindVideoSrc(this.previewElemRef.nativeElement);

                    // if the scripts lives until here, that's only one mean:

                    // permission granted
                    this.setPermission(true);

                } catch (err) {

                    console.error('zxing-scanner', 'askForPermission', err);

                    // permission aborted
                    this.setPermission(undefined);
                }

            })
            .catch((err: DOMException) => {

                // failed to grant permission to video input

                console.warn('zxing-scanner', 'askForPermission', err);

                let permission: boolean|undefined;

                switch (err.name) {

                    case 'NotAllowedError':
                        permission = false;
                        break;

                    case 'NotFoundError':
                        this.camerasNotFound.next(err);
                        break;

                }

                this.setPermission(permission);

            });

            // Returns the event emitter, so the dev can subscribe to it
            return this.permissionResponse;
    }

    /**
     * Starts the continuous scanning for the given device.
     *
     * @param deviceId The deviceId from the device.
     */
    scan(deviceId: string): void {
        try {

            this.codeReader.decodeFromInputVideoDevice((result: any) => {

                if (result) {
                    this.dispatchScanSuccess(result);
                } else {
                    this.dispatchScanFailure();
                }

                this.dispatchScanComplete(result);

            }, deviceId, this.previewElemRef.nativeElement);

        } catch (err) {
            this.dispatchScanError(err);
            this.dispatchScanComplete(undefined);
        }
    }

    /**
     * Starts the scanning if allowed.
     *
     * @param device The device to be used in the scan.
     */
    startScan(device: MediaDeviceInfo): void {
        if (this.scannerEnabled && device) {
            this.scan(device.deviceId);
        }
    }

    /**
     * Stops the scan service.
     */
    resetScan(): void {
        this.codeReader.reset();
    }

    /**
     * Stops and starts back the scan.
     */
    restartScan(): void {
        this.resetScan();
        this.startScan(this.device);
    }

    /**
     * Dispatches the scan success event.
     *
     * @param result the scan result.
     */
    private dispatchScanSuccess(result: Result): void {
        this.scanSuccess.next(result.getText());
    }

    /**
     * Dispatches the scan failure event.
     */
    private dispatchScanFailure(): void {
        this.scanFailure.next();
    }

    /**
     * Dispatches the scan error event.
     *
     * @param err the error thing.
     */
    private dispatchScanError(error: any): void {
        this.scanError.next(error);
    }

    /**
     * Dispatches the scan event.
     *
     * @param result the scan result.
     */
    private dispatchScanComplete(result: Result): void {
        this.scanComplete.next(result);
    }

    /**
     * Enumerates all the available devices.
     *
     * @param successCallback
     */
    enumarateVideoDevices(successCallback: any): void {

        if (!this.hasNavigator) {
            console.error('zxing-scanner', 'enumarateVideoDevices', 'Can\'t enumerate devices, navigator is not present.');
            return;
        }

        if (!this.isEnumerateDevicesSuported) {
            console.error('zxing-scanner', 'enumarateVideoDevices', 'Can\'t enumerate devices, method not supported.');
            return;
        }

        navigator.mediaDevices.enumerateDevices().then((devices: MediaDeviceInfo[]) => {

            this.videoInputDevices = [];

            for (const deviceI of devices) {

                // @todo type this as `MediaDeviceInfo`
                const device: any = {};

                // tslint:disable-next-line:forin
                for (const key in deviceI) {
                    device[key] = deviceI[key];
                }

                if (device.kind === 'video') {
                    device.kind = 'videoinput';
                }

                if (!device.deviceId) {
                    device.deviceId = (<any>device).id;
                }

                if (!device.label) {
                    device.label = 'Camera (no-permission)';
                }

                if (device.kind === 'videoinput') {
                    this.videoInputDevices.push(device);
                }
            }

            successCallback(this.videoInputDevices);
        });
    }
}
