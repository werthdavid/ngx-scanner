/// <reference path="./image-capture.d.ts" />

import {
    BinaryBitmap,
    HTMLCanvasElementLuminanceSource,
    HybridBinarizer,
    Exception,
    Reader,
    Result,
} from '@zxing/library';

import { BehaviorSubject } from 'rxjs/BehaviorSubject';
import { Observable } from 'rxjs/Observable';

/**
 * Based on zxing-typescript BrowserCodeReader
 */
export class BrowserCodeReader {

    /**
     * The HTML video element, used to display the camera stream.
     */
    private videoElement: HTMLVideoElement;
    /**
     * Should contain the actual registered listener for video play-ended,
     * used to unregister that listener when needed.
     */
    private videoPlayEndedEventListener: EventListener;
    /**
     * Should contain the actual registered listener for video playing,
     * used to unregister that listener when needed.
     */
    private videoPlayingEventListener: EventListener;
    /**
     * Should contain the actual registered listener for video loaded-metadata,
     * used to unregister that listener when needed.
     */
    private videoLoadedMetadataEventListener: EventListener;

    /**
     * The HTML image element, used as a fallback for the video element when decoding.
     */
    private imageElement: HTMLImageElement;
    /**
     * Should contain the actual registered listener for image loading,
     * used to unregister that listener when needed.
     */
    private imageLoadedEventListener: EventListener;

    /**
     * The HTML canvas element, used to draw the video or image's frame for decoding.
     */
    private canvasElement: HTMLCanvasElement;
    /**
     * The HTML canvas element context.
     */
    private canvasElementContext: CanvasRenderingContext2D;

    /**
     * The continuous scan timeout Id.
     */
    private timeoutHandler: number;

    /**
     * The stream output from camera.
     */
    private stream: MediaStream;
    /**
     * The track from camera.
     */
    private track: MediaStreamTrack;
    /**
     * Shows if torch is available on the camera.
     */
    private torchCompatible = new BehaviorSubject<boolean>(false);
    /**
     * The device id of the current media device.
     */
    private deviceId: string;

    /**
     * Constructor for dependency injection.
     *
     * @param reader The barcode reader to be used to decode the stream.
     * @param timeBetweenScans The scan throttling in milliseconds.
     */
    public constructor(private reader: Reader, private timeBetweenScans: number = 500) { }

    /**
     * Starts the decoding from the actual or a new video element.
     *
     * @param callbackFn The callback to be executed after every scan attempt
     * @param deviceId The device's to be used Id
     * @param videoElement A new video element
     */
    public decodeFromInputVideoDevice(callbackFn?: (result: Result) => any, deviceId?: string, videoElement?: HTMLVideoElement): void {

        if (deviceId !== undefined) {
            this.deviceId = deviceId;
        }

        this.reset();

        this.prepareVideoElement(videoElement);

        const video = this.deviceId === undefined
            ? { facingMode: { exact: 'environment' } }
            : { deviceId: { exact: this.deviceId } };

        const constraints: MediaStreamConstraints = {
            audio: false,
            video
        };

        if (typeof navigator !== 'undefined') {
            navigator
                .mediaDevices
                .getUserMedia(constraints)
                .then((stream: MediaStream) => this.startDecodeFromStream(stream, callbackFn))
                .catch((err: any) => {
                    /* handle the error, or not */
                    console.error(err);
                });
        }
    }

    /**
     * Sets the new stream and request a new decoding-with-delay.
     *
     * @param stream The stream to be shown in the video element.
     * @param callbackFn A callback for the decode method.
     */
    private startDecodeFromStream(stream: MediaStream, callbackFn?: (result: Result) => any): void {
        this.stream = stream;
        this.bindVideoSrc(this.videoElement, this.stream);
        this.bindEvents(this.videoElement, callbackFn);
        this.checkTorchCompatibility(this.stream);
    }

    /**
     * Defines what the videoElement src will be.
     *
     * @param videoElement
     * @param stream
     */
    public bindVideoSrc(videoElement: HTMLVideoElement, stream: MediaStream): void {
        // Older browsers may not have `srcObject`
        try {
            // @NOTE Throws Exception if interrupted by a new loaded request
            videoElement.srcObject = stream;
        } catch (err) {
            // @NOTE Avoid using this in new browsers, as it is going away.
            videoElement.src = window.URL.createObjectURL(stream);
        }
    }

    /**
     * Unbinds a HTML video src property.
     *
     * @param videoElement
     */
    public unbindVideoSrc(videoElement: HTMLVideoElement): void {
        try {
            videoElement.srcObject = null;
        } catch (err) {
            videoElement.src = '';
        }
    }

    /**
     * Binds listeners and callbacks to the videoElement.
     *
     * @param videoElement
     * @param callbackFn
     */
    private bindEvents(videoElement: HTMLVideoElement, callbackFn?: (result: Result) => any): void {
        if (callbackFn !== undefined) {
            this.videoPlayingEventListener = () => {
                this.decodeWithDelay(callbackFn);
            };
        }

        videoElement.addEventListener('playing', this.videoPlayingEventListener);

        this.videoLoadedMetadataEventListener = () => {
            videoElement.play();
        };

        videoElement.addEventListener('loadedmetadata', this.videoLoadedMetadataEventListener);
    }

    /**
     * Checks if the stream supports torch control.
     *
     * @param stream The media stream used to check.
     */
    private checkTorchCompatibility(stream: MediaStream): void {
        try {
            this.track = stream.getVideoTracks()[0];

            const imageCapture = new ImageCapture(this.track);

            const photoCapabilities = imageCapture.getPhotoCapabilities().then((capabilities) => {
                const compatible = !!capabilities.torch || ('fillLightMode' in capabilities && capabilities.fillLightMode.length !== 0);
                this.torchCompatible.next(compatible);
            });
        } catch (err) {
            this.torchCompatible.next(false);
        }
    }

    public setTorch(on: boolean): void {
        if (this.torchCompatible.value) {
            if (on) {
                this.track.applyConstraints({
                    advanced: [<any>{ torch: true }]
                });
            } else {
                this.restart();
            }
        }
    }

    public get torchAvailable(): Observable<boolean> {
        return this.torchCompatible.asObservable();
    }

    /**
     * Sets a HTMLVideoElement for scanning or creates a new one.
     *
     * @param videoElement The HTMLVideoElement to be set.
     */
    private prepareVideoElement(videoElement?: HTMLVideoElement): void {

        if (!videoElement && typeof document !== 'undefined') {
            videoElement = document.createElement('video');
            videoElement.width = 200;
            videoElement.height = 200;
        }

        this.videoElement = videoElement;
    }

    /**
     *
     * @param callbackFn
     */
    private decodeWithDelay(callbackFn: (result: Result) => any): void {
        window.clearTimeout(this.timeoutHandler);
        this.timeoutHandler = window.setTimeout(this.decode.bind(this, callbackFn), this.timeBetweenScans);
    }

    /**
     * Does the real image decoding job.
     *
     * @param callbackFn Callback hell.
     * @param retryIfNotFound If should retry when the QR code is just not found.
     * @param retryIfReadError If should retry on checksum or format error.
     * @param once If the decoding should run only once.
     */
    private decode(
        callbackFn: (result: Result) => any,
        retryIfNotFound: boolean = true,
        retryIfReadError: boolean = true,
        once = false
    ): void {

        // get binary bitmap for decode function
        const binaryBitmap = this.createBinaryBitmap(this.videoElement || this.imageElement);

        try {

            const result = this.reader.decode(binaryBitmap);

            callbackFn(result);

            if (!once && !!this.stream) {
                this.decodeWithDelay(callbackFn);
            }

        } catch (re) {

            // executes the callback on scanFailure.
            callbackFn(undefined);

            // scan Failure - found nothing, no error
            if (retryIfNotFound && Exception.isOfType(re, Exception.NotFoundException)) {
                this.decodeWithDelay(callbackFn);
                return;
            }

            // scan Error - found the QR but got error on decoding
            if (
                retryIfReadError &&
                (
                    Exception.isOfType(re, Exception.ChecksumException) ||
                    Exception.isOfType(re, Exception.FormatException)
                )
            ) {
                this.decodeWithDelay(callbackFn);
                return;
            }
        }
    }

    /**
     * Creates a binaryBitmap based in some image source.
     *
     * @param mediaElement HTML element containing drawable image source.
     */
    private createBinaryBitmap(mediaElement: HTMLVideoElement|HTMLImageElement): BinaryBitmap {

        if (undefined === this.canvasElementContext) {
            this.prepareCaptureCanvas();
        }

        this.canvasElementContext.drawImage(mediaElement, 0, 0);

        const luminanceSource = new HTMLCanvasElementLuminanceSource(this.canvasElement);
        const hybridBinarizer = new HybridBinarizer(luminanceSource);

        return new BinaryBitmap(hybridBinarizer);
    }

    /**
     * 🖌 Prepares the canvas for capture and scan frames.
     */
    private prepareCaptureCanvas(): void {

        if (typeof document === 'undefined') {

            this.canvasElement = undefined;
            this.canvasElementContext = undefined;

            return;
        }

        const canvasElement = document.createElement('canvas');

        let width: number;
        let height: number;

        if (this.videoElement !== undefined) {
            width = this.videoElement.videoWidth;
            height = this.videoElement.videoHeight;
        } else {
            width = this.imageElement.naturalWidth || this.imageElement.width;
            height = this.imageElement.naturalHeight || this.imageElement.height;
        }

        canvasElement.style.width = width + 'px';
        canvasElement.style.height = height + 'px';
        canvasElement.width = width;
        canvasElement.height = height;

        this.canvasElement = canvasElement;
        this.canvasElementContext = canvasElement.getContext('2d');
    }

    /**
     * Stops the continuous scan and cleans the stream.
     */
    private stop(): void {

        if (this.timeoutHandler) {
            window.clearTimeout(this.timeoutHandler);
            this.timeoutHandler = null;
        }

        if (this.stream) {
            this.stream.getTracks()[0].stop();
            this.stream = null;
        }

    }

    /**
     * Resets the scanner and it's configurations.
     */
    public reset(): void {

        // stops the camera, preview and scan 🔴

        this.stop();

        if (this.videoElement) {

            // first gives freedon to the element 🕊

            if (undefined !== this.videoPlayEndedEventListener) {
                this.videoElement.removeEventListener('ended', this.videoPlayEndedEventListener);
            }

            if (undefined !== this.videoPlayingEventListener) {
                this.videoElement.removeEventListener('playing', this.videoPlayingEventListener);
            }

            if (undefined !== this.videoLoadedMetadataEventListener) {
                this.videoElement.removeEventListener('loadedmetadata', this.videoLoadedMetadataEventListener);
            }

            if (this.stream) {
                try {
                    this.stream.getVideoTracks().forEach(track => {
                        track.stop();
                    });
                } catch (err) {

                }
            }

            // then forgets about that element 😢

            this.unbindVideoSrc(this.videoElement);

            this.videoElement.removeAttribute('src');
            this.videoElement = undefined;
        }

        if (this.imageElement) {

            // first gives freedon to the element 🕊

            if (undefined !== this.videoPlayEndedEventListener) {
                this.imageElement.removeEventListener('load', this.imageLoadedEventListener);
            }

            // then forgets about that element 😢

            this.imageElement.src = undefined;
            this.imageElement.removeAttribute('src');
            this.imageElement = undefined;
        }

        // cleans canvas references 🖌

        this.canvasElementContext = undefined;
        this.canvasElement = undefined;
    }

    private restart(): void {
        // reset
        // start
        this.decodeFromInputVideoDevice(undefined, undefined, this.videoElement);
    }
}
