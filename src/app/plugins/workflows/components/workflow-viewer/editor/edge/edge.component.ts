import {Component, computed, Input, signal, WritableSignal} from '@angular/core';
import {ClassicPreset} from 'rete';
import {ActivityNode, FAIL_CONTROL_KEY, IN_CONTROL_KEY, SUCCESS_CONTROL_KEY} from '../activity/activity.component';
import {EdgeModel, EdgeState} from '../../../../models/workflows.model';

@Component({
    selector: 'app-edge',
    templateUrl: './edge.component.html',
    styleUrl: './edge.component.scss'
})
export class EdgeComponent {
    @Input() data!: Edge<ActivityNode>;
    @Input() start: any;
    @Input() end: any;
    @Input() path: string;
}

export const EDGE_COLOR_MAP = {
    [EdgeState.IDLE]: 'black',
    [EdgeState.ACTIVE]: 'green',
    [EdgeState.INACTIVE]: 'red'
};

export class Edge<N extends ActivityNode> extends ClassicPreset.Connection<N, N> {
    isMagnetic = false; // TODO: why is this required?
    readonly state: WritableSignal<EdgeState> = signal(EdgeState.IDLE);
    readonly edgeColor = computed(() => EDGE_COLOR_MAP[this.state()]);
    readonly sourceActivityId: string; // activityId
    readonly targetActivityId: string; // activityId

    constructor(source: N, sourceOutput: keyof N['outputs'], target: N, targetInput: keyof N['inputs'], public readonly isControl, state: EdgeState) {
        super(source, sourceOutput, target, targetInput);
        this.state.set(state);
        this.sourceActivityId = source.activityId;
        this.targetActivityId = target.activityId;
        console.log('created edge', this);
    }

    public static createDataEdge(from: ActivityNode, fromPort: number, to: ActivityNode, toPort: number, state: EdgeState) {
        return new Edge(from, ActivityNode.getDataPortKey(fromPort), to, ActivityNode.getDataPortKey(toPort), false, state);
    }

    public static createControlEdge(from: ActivityNode, to: ActivityNode, fromPort: number, state: EdgeState) {
        const isSuccess = fromPort === 0;
        return new Edge(from, isSuccess ? SUCCESS_CONTROL_KEY : FAIL_CONTROL_KEY, to, IN_CONTROL_KEY, true, state);
    }

    getFromPort() {
        if (this.isControl) {
            return this.sourceOutput === SUCCESS_CONTROL_KEY ? 0 : 1;
        } else {
            // @ts-ignore
            return ActivityNode.getDataPortIndexFromKey(this.sourceOutput);
        }
    }

    getToPort() {
        if (this.isControl) {
            return IN_CONTROL_KEY;
        } else {
            // @ts-ignore
            return ActivityNode.getDataPortIndexFromKey(this.targetInput);
        }
    }

    isEquivalent(edge: EdgeModel) {
        return edge.isControl === this.isControl
            && edge.fromId === this.sourceActivityId && edge.fromPort === this.getFromPort()
            && edge.toId === this.targetActivityId && edge.toPort === this.getToPort();
    }
}
