import {Component, Input, Type} from '@angular/core';
import {BooleanArg} from '../../models/polyalg-plan.model';
import {ArgControl} from '../arg-control';

@Component({
    selector: 'app-boolean-arg',
    templateUrl: './boolean-arg.component.html',
    styleUrl: './boolean-arg.component.scss'
})
export class BooleanArgComponent {
    @Input() data: BooleanControl;

}

export class BooleanControl extends ArgControl {
    constructor(name: string, public value: BooleanArg, readonly: boolean) {
        super(name, readonly);
    }

    getHeight(): number {
        return 50;
    }

    getArgComponent(): Type<any> {
        return BooleanArgComponent;
    }
}
