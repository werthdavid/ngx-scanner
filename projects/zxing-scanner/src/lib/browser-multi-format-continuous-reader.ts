import { ChecksumException, FormatException, NotFoundException } from '@zxing/library';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { BehaviorSubject, Observable } from 'rxjs';
import { ResultAndError } from './ResultAndError';

/**
 * Based on zxing-typescript BrowserCodeReader
 */
export class BrowserMultiFormatContinuousReader extends BrowserMultiFormatReader {

  /**
   * Allows to call scanner controls API while scanning.
   * Will be undefined if no scanning is runnig.
   */
  protected scannerControls: IScannerControls;

  /**
   * Returns the code reader scanner controls.
   */
  public getScannerControls(): IScannerControls {
    if (!this.scannerControls) {
      throw new Error('No scanning is running at the time.');
    }
    return this.scannerControls;
  }

  /**
   * Starts the decoding from the current or a new video element.
   *
   * @param deviceId The device's to be used Id
   * @param previewEl A new video element
   */
  public async scanFromDeviceObservable(
    deviceId?: string,
    previewEl?: HTMLVideoElement
  ): Promise<Observable<ResultAndError>> {

    const scan$ = new BehaviorSubject<ResultAndError>({});
    let ctrls;

    try {
      ctrls = await this.decodeFromVideoDevice(deviceId, previewEl, (result, error) => {

        if (!error) {
          scan$.next({ result });
          return;
        }

        const errorName = error.name;

        // stream cannot stop on fails.
        if (
          // scan Failure - found nothing, no error
          errorName === NotFoundException.name ||
          // scan Error - found the QR but got error on decoding
          errorName === ChecksumException.name ||
          errorName === FormatException.name ||
          error.message.includes('No MultiFormat Readers were able to detect the code.')
        ) {
          scan$.next({ error });
          return;
        }

        // probably fatal error
        scan$.error(error);
        this.scannerControls?.stop();
        this.scannerControls = undefined;
        return;
      });

      this.scannerControls = {
        ...ctrls,
        stop() {
          ctrls.stop();
          scan$.complete();
        },
      };
    } catch (e) {
      scan$.error(e);
      this.scannerControls?.stop();
      this.scannerControls = undefined;
    }

    return scan$.asObservable();
  }
}
