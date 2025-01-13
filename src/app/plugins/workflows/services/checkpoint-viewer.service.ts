import {computed, Injectable, signal, WritableSignal} from '@angular/core';
import {WorkflowsWebSocketService} from './workflows-websocket.service';
import {CheckpointDataResponse, ResponseType, WsResponse} from '../models/ws-response.model';
import {Result} from '../../../components/data-view/models/result-set.model';
import {Activity} from '../components/workflow-viewer/workflow';

@Injectable()
export class CheckpointViewerService {
    readonly showModal = signal(false);

    readonly selectedActivity = signal<Activity>(undefined);
    readonly selectedOutput = signal<number>(0);
    readonly isLoading = signal(false);
    result: WritableSignal<Result<any, any>> = signal(null);
    readonly limit = signal(0);
    readonly totalCount = signal(0);
    readonly isLimited = computed(() => this.totalCount() > this.limit());

    constructor(private readonly _websocket: WorkflowsWebSocketService) {
        this._websocket.onMessage().subscribe(msg => this.handleWsMsg(msg));

    }

    toggleModal() {
        this.setModal(!this.showModal());
    }

    setModal(visible: boolean) {
        this.showModal.set(visible);
        if (!visible) {
            this.selectedActivity.set(null);
            this.result.set(null);
        }
    }

    getCheckpoint(activity: Activity, outputIndex: number) {
        this.selectedActivity.set(activity);
        this.selectedOutput.set(outputIndex);
        this.isLoading.set(true);
        this._websocket.getCheckpoint(activity.id, outputIndex);

    }

    private handleWsMsg(msg: { response: WsResponse; isDirect: boolean }) {
        const {response, isDirect} = msg;
        if (response.type === ResponseType.CHECKPOINT_DATA) {
            const r = (response as CheckpointDataResponse);
            console.log(r);
            this.result.set(r.result);
            this.limit.set(r.limit);
            this.totalCount.set(r.totalCount);
            this.isLoading.set(false);
        }
    }

    materializeCheckpoints(activityId: string) {
        this._websocket.execute(activityId);
    }
}
