import {ClassicPreset} from 'rete';
import {Type} from '@angular/core';
import {Parameter} from '../models/polyalg-registry';
import {PlanArgument} from '../models/polyalg-plan.model';

export abstract class ArgControl extends ClassicPreset.Control {
    readonly name: string;

    protected constructor(public readonly param: Parameter, public isReadOnly: boolean, isForOuter = false) {
        super();
        this.name = param.isMultiValued && !isForOuter ? null : param.name;
    }

    abstract getHeight(): number;

    abstract getArgComponent(): Type<any>;

    abstract toPolyAlg(): string;

    abstract copyArg(): PlanArgument;
}
