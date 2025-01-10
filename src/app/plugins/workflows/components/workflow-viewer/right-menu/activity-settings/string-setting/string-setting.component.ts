import {Component, computed, EventEmitter, input, model, Output} from '@angular/core';
import {SettingDef} from '../../../../../models/activity-registry.model';
import {TypePreviewModel} from '../../../../../models/workflows.model';

@Component({
    selector: 'app-string-setting',
    templateUrl: './string-setting.component.html',
    styleUrl: './string-setting.component.scss'
})
export class StringSettingComponent {
    isEditable = input.required<boolean>();
    settingDef = input.required<SettingDef>();
    inTypePreview = input.required<TypePreviewModel[]>(); // not required for int
    value = model.required<any>();
    @Output() hasChanged = new EventEmitter<void>();

    def = computed<StringSettingDef>(() => this.settingDef() as StringSettingDef);
    // TODO: change appearance if isList
}

interface StringSettingDef extends SettingDef {
    isList: boolean;
    minLength: number;
    maxLength: number;
}
