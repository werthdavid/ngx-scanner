import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild
} from '@angular/core';
import { BrowserCodeReader } from '@zxing/browser';
import {
  BarcodeFormat,
  DecodeHintType,
  Exception,
  Result
} from '@zxing/library';
import { Subscription } from 'rxjs';
import { BrowserMultiFormatContinuousReader } from './browser-multi-format-continuous-reader';
import { ResultAndError } from './ResultAndError';


@Component({
  selector: 'zxing-scanner',
  templateUrl: './zxing-scanner.component.html',
  styleUrls: ['./zxing-scanner.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ZXingScannerComponent implements OnInit, OnDestroy {

  /**
   * Supported Hints map.
   */
  private _hints: Map<DecodeHintType, any> | null;

  /**
   * The ZXing code reader.
   */
  private _codeReader: BrowserMultiFormatContinuousReader;

  /**
   * The device that should be used to scan things.
   */
  private _device: MediaDeviceInfo;

  /**
   * The device that should be used to scan things.
   */
  private _enabled: boolean;

  /**
   *
   */
  private _isAutostarting: boolean;

  /**
   * Has `navigator` access.
   */
  private hasNavigator: boolean;

  /**
   * Says if some native API is supported.
   */
  private isMediaDevicesSupported: boolean;

  /**
   * If the user-agent allowed the use of the camera or not.
   */
  private hasPermission: boolean | null;

  /**
   * Unsubscribe to stop scanning.
   */
  private _scanSubscription?: Subscription;

  /**
   * Reference to the preview element, should be the `video` tag.
   */
  @ViewChild('preview', { static: true })
  previewElemRef: ElementRef<HTMLVideoElement>;

  /**
   * Enable or disable autofocus of the camera (might have an impact on performance)
   */
  @Input()
  autofocusEnabled: boolean;

  /**
   * Delay between attempts to decode (default is 500ms)
   */
  @Input()
  timeBetweenScans = 500;

  /**
   * Delay between successful decode (default is 500ms)
   */
  @Input()
  delayBetweenScanSuccess = 500;

  /**
   * Emits when and if the scanner is autostarted.
   */
  @Output()
  autostarted: EventEmitter<void>;

  /**
   * True during autostart and false after. It will be null if won't autostart at all.
   */
  @Output()
  autostarting: EventEmitter<boolean>;

  /**
   * If the scanner should autostart with the first available device.
   */
  @Input()
  autostart: boolean;

  /**
   * How the preview element shoud be fit inside the :host container.
   */
  @Input()
  previewFitMode: 'fill' | 'contain' | 'cover' | 'scale-down' | 'none' = 'cover';

  /**
   * Emitts events when the torch compatibility is changed.
   */
  @Output()
  torchCompatible: EventEmitter<boolean>;

  /**
   * Emitts events when a scan is successful performed, will inject the string value of the QR-code to the callback.
   */
  @Output()
  scanSuccess: EventEmitter<string>;

  /**
   * Emitts events when a scan fails without errors, usefull to know how much scan tries where made.
   */
  @Output()
  scanFailure: EventEmitter<Exception | undefined>;

  /**
   * Emitts events when a scan throws some error, will inject the error to the callback.
   */
  @Output()
  scanError: EventEmitter<Error>;

  /**
   * Emitts events when a scan is performed, will inject the Result value of the QR-code scan (if available) to the callback.
   */
  @Output()
  scanComplete: EventEmitter<Result>;

  /**
   * Emitts events when no cameras are found, will inject an exception (if available) to the callback.
   */
  @Output()
  camerasFound: EventEmitter<MediaDeviceInfo[]>;

  /**
   * Emitts events when no cameras are found, will inject an exception (if available) to the callback.
   */
  @Output()
  camerasNotFound: EventEmitter<any>;

  /**
   * Emitts events when the users answers for permission.
   */
  @Output()
  permissionResponse: EventEmitter<boolean>;

  /**
   * Emitts events when has devices status is update.
   */
  @Output()
  hasDevices: EventEmitter<boolean>;

  private _ready = false;

  private _devicePreStart: MediaDeviceInfo;

  /**
   * Exposes the current code reader, so the user can use it's APIs.
   */
  get codeReader(): BrowserMultiFormatContinuousReader {
    return this._codeReader;
  }

  /**
   * User device input
   */
  @Input()
  set device(device: MediaDeviceInfo | undefined) {

    if (!this._ready) {
      this._devicePreStart = device;
      // let's ignore silently, users don't liek logs
      return;
    }

    if (this.isAutostarting) {
      // do not allow setting devices during auto-start, since it will set one and emit it.
      console.warn('Avoid setting a device during auto-start.');
      return;
    }

    if (this.isCurrentDevice(device)) {
      console.warn('Setting the same device is not allowed.');
      return;
    }

    if (!this.hasPermission) {
      console.warn('Permissions not set yet, waiting for them to be set to apply device change.');
      // this.permissionResponse
      //   .pipe(
      //     take(1),
      //     tap(() => console.log(`Permissions set, applying device change${device ? ` (${device.deviceId})` : ''}.`))
      //   )
      //   .subscribe(() => this.device = device);
      return;
    }

    this.setDevice(device).catch(
        (error: any) => {
            console.error('@zxing/ngx-scanner', 'Error while setting the device.', error);
        }
    );
  }

  /**
   * Emits when the current device is changed.
   */
  @Output()
  deviceChange: EventEmitter<MediaDeviceInfo>;

  /**
   * User device acessor.
   */
  get device() {
    return this._device;
  }

  /**
   * Returns all the registered formats.
   */
  get formats(): BarcodeFormat[] {
    return this.hints.get(DecodeHintType.POSSIBLE_FORMATS);
  }

  /**
   * Registers formats the scanner should support.
   *
   * @param input BarcodeFormat or case-insensitive string array.
   */
  @Input()
  set formats(input: BarcodeFormat[]) {

    if (typeof input === 'string') {
      throw new Error('Invalid formats, make sure the [formats] input is a binding.');
    }

    // formats may be set from html template as BarcodeFormat or string array
    const formats = input.map(f => this.getBarcodeFormatOrFail(f));

    const hints = this.hints;

    // updates the hints
    hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);

    // handles updating the codeReader
    this.hints = hints;
  }

  /**
   * Returns all the registered hints.
   */
  get hints() {
    return this._hints;
  }

  /**
   * Does what it takes to set the hints.
   */
  set hints(hints: Map<DecodeHintType, any>) {
    this._hints = hints;
    // new instance with new hints.
    this.codeReader?.setHints(this._hints);
  }

  /**
   * Sets the desired constraints in all video tracks.
   * @experimental
   */
  @Input()
  set videoConstraints(constraints: MediaTrackConstraints) {
    // new instance with new hints.
    const controls = this.codeReader?.getScannerControls();

    if (!controls) {
      // fails silently
      return;
    }

    controls?.streamVideoConstraintsApply(constraints);
  }

  /**
   *
   */
  set isAutostarting(state: boolean) {
    this._isAutostarting = state;
    this.autostarting.next(state);
  }

  /**
   *
   */
  get isAutostarting(): boolean {
    return this._isAutostarting;
  }

  /**
   * Can turn on/off the device flashlight.
   *
   * @experimental Torch/Flash APIs are not stable in all browsers, it may be buggy!
   */
  @Input()
  set torch(onOff: boolean) {
    try {
      const controls = this.getCodeReader().getScannerControls();
      controls.switchTorch(onOff);
    } catch (error) {
      // ignore error
    }
  }

  /**
   * Starts and Stops the scanning.
   */
  @Input()
  set enable(enabled: boolean) {

    this._enabled = Boolean(enabled);

    if (!this._enabled) {
      this.reset();
    } else {
      if (this.device) {
        this.scanFromDevice(this.device.deviceId);
      } else {
        this.init();
      }
    }
  }

  /**
   * Tells if the scanner is enabled or not.
   */
  get enabled(): boolean {
    return this._enabled;
  }

  /**
   * If is `tryHarder` enabled.
   */
  get tryHarder(): boolean {
    return this.hints.get(DecodeHintType.TRY_HARDER);
  }

  /**
   * Enable/disable tryHarder hint.
   */
  @Input()
  set tryHarder(enable: boolean) {

    const hints = this.hints;

    if (enable) {
      hints.set(DecodeHintType.TRY_HARDER, true);
    } else {
      hints.delete(DecodeHintType.TRY_HARDER);
    }

    this.hints = hints;
  }

  /**
   * Constructor to build the object and do some DI.
   */
  constructor() {
    // instance based emitters
    this.autostarted = new EventEmitter();
    this.autostarting = new EventEmitter();
    this.torchCompatible = new EventEmitter(false);
    this.scanSuccess = new EventEmitter();
    this.scanFailure = new EventEmitter();
    this.scanError = new EventEmitter();
    this.scanComplete = new EventEmitter();
    this.camerasFound = new EventEmitter();
    this.camerasNotFound = new EventEmitter();
    this.permissionResponse = new EventEmitter(true);
    this.hasDevices = new EventEmitter();
    this.deviceChange = new EventEmitter();

    this._enabled = true;
    this._hints = new Map<DecodeHintType, any>();
    this.autofocusEnabled = true;
    this.autostart = true;
    this.formats = [BarcodeFormat.QR_CODE];

    // computed data
    this.hasNavigator = typeof navigator !== 'undefined';
    this.isMediaDevicesSupported = this.hasNavigator && !!navigator.mediaDevices;
  }

  /**
   * Gets and registers all cammeras.
   */
  async askForPermission(): Promise<boolean> {

    if (!this.hasNavigator) {
      console.error('@zxing/ngx-scanner', 'Can\'t ask permission, navigator is not present.');
      this.setPermission(null);
      return this.hasPermission;
    }

    if (!this.isMediaDevicesSupported) {
      console.error('@zxing/ngx-scanner', 'Can\'t get user media, this is not supported.');
      this.setPermission(null);
      return this.hasPermission;
    }

    let stream: MediaStream;
    let permission: boolean;

    try {
      // Will try to ask for permission
      stream = await this.getAnyVideoDevice();
      permission = !!stream;
    } catch (err) {
      return this.handlePermissionException(err);
    } finally {
      this.terminateStream(stream);
    }

    this.setPermission(permission);

    // Returns the permission
    return permission;
  }

  /**
   *
   */
  getAnyVideoDevice(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({ video: true });
  }

  /**
   * Terminates a stream and it's tracks.
   */
  private terminateStream(stream: MediaStream) {

    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }

    stream = undefined;
  }

  private async init() {
    if (!this.autostart) {
      console.warn('Feature \'autostart\' disabled. Permissions and devices recovery has to be run manually.');

      // does the necessary configuration without autostarting
      this.initAutostartOff();

      this._ready = true;

      return;
    }

    // configurates the component and starts the scanner
    await this.initAutostartOn();

    this._ready = true;
  }

  /**
   * Initializes the component without starting the scanner.
   */
  private initAutostartOff(): void {

    // do not ask for permission when autostart is off
    this.isAutostarting = false;

    // just update devices information
    this.updateVideoInputDevices();

    if (this._device && this._devicePreStart) {
      this.setDevice(this._devicePreStart);
    }
  }

  /**
   * Initializes the component and starts the scanner.
   * Permissions are asked to accomplish that.
   */
  private async initAutostartOn(): Promise<void> {

    this.isAutostarting = true;

    let hasPermission: boolean;

    try {
      // Asks for permission before enumerating devices so it can get all the device's info
      hasPermission = await this.askForPermission();
    } catch (e) {
      console.error('Exception occurred while asking for permission:', e);
      return;
    }

    // from this point, things gonna need permissions
    if (hasPermission) {
      const devices = await this.updateVideoInputDevices();
      await this.autostartScanner([...devices]);
    }

    this.isAutostarting = false;
    this.autostarted.next();
  }

  /**
   * Checks if the given device is the current defined one.
   */
  isCurrentDevice(device?: MediaDeviceInfo) {
    return device?.deviceId === this._device?.deviceId;
  }

  /**
   * Executes some actions before destroy the component.
   */
  ngOnDestroy(): void {
    this.reset();
  }

  /**
   *
   */
  ngOnInit(): void {
    this.init();
  }

  /**
   * Stops the scanning, if any.
   */
  public scanStop() {
    if (this._scanSubscription) {
      this.codeReader?.getScannerControls().stop();
      this._scanSubscription?.unsubscribe();
      this._scanSubscription = undefined;
    }
    this.torchCompatible.next(false);
  }

  /**
   * Stops the scanning, if any.
   */
  public scanStart() {

    if (this._scanSubscription) {
      throw new Error('There is already a scan proccess running.');
    }

    if (!this._device) {
      throw new Error('No device defined, cannot start scan, please define a device.');
    }

    this.scanFromDevice(this._device.deviceId);
  }

  /**
   * Stops old `codeReader` and starts scanning in a new one.
   */
  restart(): void {
    // @note apenas necessario por enquanto causa da Torch
    this._codeReader = undefined;

    const prevDevice = this._reset();

    if (!prevDevice) {
      return;
    }

    this.device = prevDevice;
  }

  /**
   * Discovers and updates known video input devices.
   */
  async updateVideoInputDevices(): Promise<MediaDeviceInfo[]> {

    // permissions aren't needed to get devices, but to access them and their info
    const devices = await BrowserCodeReader.listVideoInputDevices() || [];
    const hasDevices = devices && devices.length > 0;

    // stores discovered devices and updates information
    this.hasDevices.next(hasDevices);
    this.camerasFound.next([...devices]);

    if (!hasDevices) {
      this.camerasNotFound.next();
    }

    return devices;
  }

  /**
   * Starts the scanner with the back camera otherwise take the last
   * available device.
   */
  private async autostartScanner(devices: MediaDeviceInfo[]): Promise<void> {

    const matcher = ({ label }) => /back|trás|rear|traseira|environment|ambiente/gi.test(label);

    // select the rear camera by default, otherwise take the last camera.
    const device = devices.find(matcher) || devices.pop();

    if (!device) {
      throw new Error('Impossible to autostart, no input devices available.');
    }

    await this.setDevice(device);

    this.deviceChange.next(device);
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
  private dispatchScanFailure(reason?: Exception): void {
    this.scanFailure.next(reason);
  }

  /**
   * Dispatches the scan error event.
   *
   * @param error the error thing.
   */
  private dispatchScanError(error: any): void {
    if (!this.scanError.observers.some(x => Boolean(x))) {
      console.error(`zxing scanner component: ${error.name}`, error);
      console.warn('Use the `(scanError)` property to handle errors like this!');
    }
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
   * Returns the filtered permission.
   */
  private handlePermissionException(err: DOMException): boolean {

    // failed to grant permission to video input
    console.error('@zxing/ngx-scanner', 'Error when asking for permission.', err);

    let permission: boolean;

    switch (err.name) {

      // usually caused by not secure origins
      case 'NotSupportedError':
        console.warn('@zxing/ngx-scanner', err.message);
        // could not claim
        permission = null;
        // can't check devices
        this.hasDevices.next(null);
        break;

      // user denied permission
      case 'NotAllowedError':
        console.warn('@zxing/ngx-scanner', err.message);
        // claimed and denied permission
        permission = false;
        // this means that input devices exists
        this.hasDevices.next(true);
        break;

      // the device has no attached input devices
      case 'NotFoundError':
        console.warn('@zxing/ngx-scanner', err.message);
        // no permissions claimed
        permission = null;
        // because there was no devices
        this.hasDevices.next(false);
        // tells the listener about the error
        this.camerasNotFound.next(err);
        break;

      case 'NotReadableError':
        console.warn('@zxing/ngx-scanner', 'Couldn\'t read the device(s)\'s stream, it\'s probably in use by another app.');
        // no permissions claimed
        permission = null;
        // there are devices, which I couldn't use
        this.hasDevices.next(false);
        // tells the listener about the error
        this.camerasNotFound.next(err);
        break;

      default:
        console.warn('@zxing/ngx-scanner', 'I was not able to define if I have permissions for camera or not.', err);
        // unknown
        permission = null;
        // this.hasDevices.next(undefined;
        break;

    }

    this.setPermission(permission);

    // tells the listener about the error
    this.permissionResponse.error(err);

    return permission;
  }

  /**
   * Returns a valid BarcodeFormat or fails.
   */
  private getBarcodeFormatOrFail(format: string | BarcodeFormat): BarcodeFormat {
    return typeof format === 'string'
      ? BarcodeFormat[format.trim().toUpperCase()]
      : format;
  }

  /**
   * Retorna um code reader, cria um se nenhume existe.
   */
  private getCodeReader(): BrowserMultiFormatContinuousReader {

    if (!this._codeReader) {
      const options = {
        delayBetweenScanAttempts: this.timeBetweenScans,
        delayBetweenScanSuccess: this.delayBetweenScanSuccess,
      };
      this._codeReader = new BrowserMultiFormatContinuousReader(this.hints, options);
    }

    return this._codeReader;
  }

  /**
   * Starts the continuous scanning for the given device.
   *
   * @param deviceId The deviceId from the device.
   */
  private async scanFromDevice(deviceId: string): Promise<void> {

    const videoElement = this.previewElemRef.nativeElement;

    const codeReader = this.getCodeReader();

    const scanStream = await codeReader.scanFromDeviceObservable(deviceId, videoElement);

    if (!scanStream) {
      throw new Error('Undefined decoding stream, aborting.');
    }

    const next = (x: ResultAndError) => this._onDecodeResult(x.result, x.error);
    const error = (err: any) => this._onDecodeError(err);
    const complete = () => { };

    this._scanSubscription = scanStream.subscribe(next, error, complete);

    if (this._scanSubscription.closed) {
      return;
    }

    const controls = codeReader.getScannerControls();
    const hasTorchControl = typeof controls.switchTorch !== 'undefined';

    this.torchCompatible.next(hasTorchControl);
  }

  /**
   * Handles decode errors.
   */
  private _onDecodeError(err: any) {
    this.dispatchScanError(err);
    // this.reset();
  }

  /**
   * Handles decode results.
   */
  private _onDecodeResult(result: Result, error: Exception): void {

    if (result) {
      this.dispatchScanSuccess(result);
    } else {
      this.dispatchScanFailure(error);
    }

    this.dispatchScanComplete(result);
  }

  /**
   * Stops the code reader and returns the previous selected device.
   */
  private _reset(): MediaDeviceInfo {

    if (!this._codeReader) {
      return;
    }

    const device = this._device;
    // do not set this.device inside this method, it would create a recursive loop
    this.device = undefined;

    this._codeReader = undefined;

    return device;
  }

  /**
   * Resets the scanner and emits device change.
   */
  public reset(): void {
    this._reset();
    this.deviceChange.emit(null);
  }

  /**
   * Sets the current device.
   */
  private async setDevice(device: MediaDeviceInfo): Promise<void> {

    // instantly stops the scan before changing devices
    this.scanStop();

    // correctly sets the new (or none) device
    this._device = device || undefined;

    if (!this._device) {
      // cleans the video because user removed the device
      BrowserCodeReader.cleanVideoSource(this.previewElemRef.nativeElement);
    }

    // if enabled, starts scanning
    if (this._enabled && device) {
      await this.scanFromDevice(device.deviceId);
    }
  }

  /**
   * Sets the permission value and emmits the event.
   */
  private setPermission(hasPermission: boolean | null): void {
    this.hasPermission = hasPermission;
    this.permissionResponse.next(hasPermission);
  }

}
