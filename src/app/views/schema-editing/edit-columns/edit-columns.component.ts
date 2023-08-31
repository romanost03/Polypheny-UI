import {Component, HostListener, OnDestroy, OnInit} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import * as $ from 'jquery';
import {LeftSidebarService} from '../../../components/left-sidebar/left-sidebar.service';
import {CrudService} from '../../../services/crud.service';
import {FieldType, IndexModel, ModifyPartitionRequest, PartitionFunctionModel, PartitioningRequest, PolyType, RelationalResult, TableConstraint, UiColumnDefinition} from '../../../components/data-view/models/result-set.model';
import {ToastDuration, ToasterService} from '../../../components/toast-exposer/toaster.service';
import {UntypedFormControl, UntypedFormGroup, Validators} from '@angular/forms';
import {ColumnRequest, ConstraintRequest, EditTableRequest, MaterializedRequest, Method} from '../../../models/ui-request.model';
import {DbmsTypesService} from '../../../services/dbms-types.service';
import {MaterializedInfos, PlacementType, StoreModel} from '../../adapters/adapter.model';
import {BehaviorSubject, combineLatest, firstValueFrom, forkJoin, Observable, Subscription} from 'rxjs';
import {ForeignKey, Uml} from '../../../views/uml/uml.model';
import {CatalogService} from '../../../services/catalog.service';
import {AllocationEntityModel, AllocationPartitionModel, AllocationPlacementModel, ConstraintModel, EntityType, NamespaceModel, TableModel} from '../../../models/catalog.model';
import {filter, map, mergeMap} from 'rxjs/operators';

const INITIAL_TYPE = 'BIGINT';

@Component({
  selector: 'app-edit-columns',
  templateUrl: './edit-columns.component.html',
  styleUrls: ['./edit-columns.component.scss']
})

export class EditColumnsComponent implements OnInit, OnDestroy {

  constructor(
      private _route: ActivatedRoute,
      private _leftSidebar: LeftSidebarService,
      public _crud: CrudService,
      private _toast: ToasterService,
      public _types: DbmsTypesService,
      public _catalog: CatalogService
  ) {
    this.newIndexForm = new UntypedFormGroup({
      name: new UntypedFormControl('', this._crud.getNameValidator()),
      method: new UntypedFormControl('')
    });
    this.subscribe();
    this._types.getTypes().subscribe(
        (type: PolyType[]) => {
          this.types = type;
          this.createColumn.dataType = INITIAL_TYPE;
        }
    );
  }

  readonly entity: BehaviorSubject<TableModel> = new BehaviorSubject<TableModel>(null);
  readonly namespace: BehaviorSubject<NamespaceModel> = new BehaviorSubject<NamespaceModel>(null);
  readonly currentRoute: BehaviorSubject<string> = new BehaviorSubject<string>(this._route.snapshot.paramMap.get('id'));

  foreignKeys: ForeignKey[] = [];

  types: PolyType[] = [];
  editColumn = -1;
  createColumn = new UiColumnDefinition('', false, true, 'text', '', null, null, null);
  confirm = -1;
  readonly oldColumns = new BehaviorSubject(new Map<string, UiColumnDefinition>());
  updateColumn = new UntypedFormGroup({name: new UntypedFormControl('')});

  constraints: Observable<ConstraintModel[]>;
  confirmConstraint = -1;
  newPrimaryKey: UiColumnDefinition[];

  uniqueConstraintName = '';
  proposedConstraintName = 'constraintName';

  indexes: RelationalResult;
  newIndexCols = new Map<string, boolean>();
  selectedStoreForIndex: StoreModel;
  newIndexForm: UntypedFormGroup;
  indexSubmitted = false;
  proposedIndexName = 'indexName';
  addingIndex = false;

  materializedInfo: BehaviorSubject<[]> = new BehaviorSubject<[]>([]);

  //data placement handling
  readonly stores: BehaviorSubject<StoreModel[]> = new BehaviorSubject<StoreModel[]>([]);
  availableStoresForIndexes: BehaviorSubject<StoreModel[]> = new BehaviorSubject([]);
  selectedStore: StoreModel;
  readonly placements: BehaviorSubject<AllocationPlacementModel[]> = new BehaviorSubject([]);
  readonly partitions: BehaviorSubject<AllocationPartitionModel[]> = new BehaviorSubject([]);
  readonly allocations: BehaviorSubject<AllocationEntityModel[]> = new BehaviorSubject([]);

  columnPlacement: UntypedFormGroup;
  placementMethod: Method;
  isAddingPlacement = false;

  //partition handling
  partitionTypes: string[];
  partitioningRequest: PartitioningRequest = new PartitioningRequest();
  isMergingPartitions = false;
  partitionsToModify: { partitionName: string, selected: boolean }[];
  partitionFunctionParams: PartitionFunctionModel;
  fieldTypes: typeof FieldType = FieldType;

  subscriptions = new Subscription();

  placementModal = false;
  partitioningModal = false;
  partitionFunctionModal = false;


  public readonly EntityType = EntityType;

  protected readonly Method = Method;

  ngOnInit() {

    this._route.params.subscribe(route => {
      this.currentRoute.next(route['id']);
    });

    const sub = this.currentRoute.subscribe(route => {
      const splits = route.split('\.');

      this._catalog.getNamespaceFromName(splits[0]).subscribe(n => {
        this.namespace.next(n);
      });
      this._catalog.getEntityFromName(splits[0], splits[1]).subscribe(entity => {
        this.entity.next(<TableModel>entity);
      });

      //this.getPlacementsAndPartitions();
      this.getAvailableStoresForIndexes();
      this.getUml();

      firstValueFrom(this.entity.pipe(filter(e => !!e))).then(e => {
        if (e.entityType === EntityType.MATERIALIZED_VIEW) {
          this.subscribeMaterializedInfo();
        }
      });

      this.subscribeIndexes();

      this.initNewIndexValues();
    });


    this.subscriptions.add(sub);

    this.getPartitionTypes();
    this.getGeneratedNames();
  }

  ngOnDestroy() {
    $(document).off('click');
    this.subscriptions.unsubscribe();
  }

  //see https://medium.com/claritydesignsystem/1b66d45b3e3d
  @HostListener('window:click', ['$event.target'])
  onClick(targetElement: string) {
    const self = this;
    if ($(targetElement).parents('.editing').length === 0) {
      self.editColumn = -1;
    }
  }

  isEntityType(type: EntityType): Observable<boolean> {
    return this.entity.pipe(filter(e => !!e), map(e => e.entityType === type));
  }

  subscribe() {
    this.entity.pipe(
        filter(n => !!n),
        mergeMap(entity => this._catalog.getColumns(entity.id))).subscribe(columns => {

      this.oldColumns.next(new Map(columns.map(c => {
        const columnIds = this._catalog.getPrimaryKey(c.entityId)?.value?.columnIds || [];
        return UiColumnDefinition.fromModel(c, columnIds);
      }).map(c => [c.name, c])));

    });

    this.oldColumns.pipe(
        filter(n => !!this.entity.value),
        filter(n => !!n),
        map(n => Array.from(n.values()))).subscribe(columns => {
      this.newIndexCols = new Map(columns.map(c => [c.name, false]));

      this.partitioningRequest.column = columns.length !== 0 ? columns[0].name : '';
      this.newPrimaryKey = Array.from(this.oldColumns.value.values()).map(x => Object.assign({}, x));
      this.constraints = this._catalog.getConstraints(this.entity.value.id);
    });

    this.entity.pipe(filter(n => !!n)).subscribe(entity => {
      this._catalog.getPlacements(entity.id).subscribe(placements => {
        this.placements.next(placements);
      });

      this._catalog.getPartitions(entity.id).subscribe(partitions => {
        this.partitions.next(partitions);
      });
    });

  }

  columnValidation(columnName: string, editing: string = null) {
    if (editing) {
      if (Array.from(this.oldColumns.value.values()).filter((h) => h.name === columnName && h.name !== editing).length > 0) {
        return 'is-invalid';
      }
    } else {
      if (Array.from(this.oldColumns.value.values()).filter((h) => h.name === columnName).length > 0) {
        return 'is-invalid';
      }
    }
    return this._crud.getValidationClass(columnName);
  }

  editCol(i: number, col: UiColumnDefinition, e = null) {
    if (e.target.id === 'delete') {
      return;
    }
    if (this.editColumn !== i) {
      if (col.defaultValue === undefined) {
        col.defaultValue = null;
      }
      this.updateColumn = new UntypedFormGroup({
        name: new UntypedFormControl(col.name, Validators.required),
        oldName: new UntypedFormControl(col.name),
        nullable: new UntypedFormControl(col.nullable),
        dataType: new UntypedFormControl(col.dataType),
        collectionsType: new UntypedFormControl(col.collectionsType),
        precision: new UntypedFormControl(col.precision),
        scale: new UntypedFormControl(col.scale),
        dimension: new UntypedFormControl(col.dimension),
        cardinality: new UntypedFormControl(col.cardinality),
        defaultValue: new UntypedFormControl({value: col.defaultValue, disabled: col.defaultValue === null})
      });
      this.editColumn = i;
    }
  }

  subscribeMaterializedInfo() {
    firstValueFrom(this.entity.pipe(filter(e => !!e), mergeMap(() => this._crud.getMaterializedInfo(new EditTableRequest(this.namespace.value.id, this.entity.value.id))))).then(
        (mat: MaterializedInfos) => {
          this.materializedInfo.next(mat.materializedInfo);
        }).catch(err => {
      console.log(err);
    });

  }

  updateMaterialized() {
    const req = new MaterializedRequest(this.entity.value.id);
    this._crud.updateMaterialized(req).subscribe({
      next: (res: RelationalResult) => {
        this.subscribeMaterializedInfo();
        if (res.error) {
          this._toast.exception(res, 'Could not update materialized view:');
        } else {
          this._toast.success('Materialized view was updated', res.query, 'Updated');
        }
      }, error: err => {
        this._toast.error('Could not update materialized view due to an error on the server.', null, ToastDuration.INFINITE);
        console.log(err);
      }
    });
  }


  updateMaterializedColumn(oldCol: UiColumnDefinition, newName) {
    const newCol = Object.assign({}, oldCol);
    newCol.name = newName;
    const req = new ColumnRequest(this.entity.value.id, oldCol, newCol, true, 'MATERIALIZED');

    this._crud.updateColumn(req).subscribe({
      next: (res: RelationalResult) => {
        this.editColumn = -1;
        this._catalog.updateIfNecessary();
        if (res.error) {
          this._toast.exception(res, 'Could not update column:');
        } else {
          this._toast.success('The column was renamed.', res.query, 'column saved');
        }
      }, error: err => {
        this._toast.error('Could not save column due to an error on the server.', null, ToastDuration.INFINITE);
        console.log(err);
      }
    });
  }


  saveCol() {
    if (!this._crud.nameIsValid(this.updateColumn.controls['name'].value)) {
      this._toast.warn(this._crud.invalidNameMessage('column'), 'invalid column name');
      return;
    }
    if (Array.from(this.oldColumns.value.values()).filter((h) => h.name === this.updateColumn.controls['name'].value && h.name !== this.updateColumn.controls['oldName'].value).length > 0) {
      this._toast.warn('This column name already exists', 'invalid column name');
      return;
    }
    const oldColumn = this.oldColumns.value.get(this.updateColumn.controls['oldName'].value);
    const newColumn = new UiColumnDefinition(
        this.updateColumn.controls['name'].value,
        null,
        this.updateColumn.controls['nullable'].value,
        this.updateColumn.controls['dataType'].value,
        this.updateColumn.controls['collectionsType'].value,
        this.updateColumn.controls['precision'].value,
        this.updateColumn.controls['scale'].value,
        this.updateColumn.controls['defaultValue'].value,
        this.updateColumn.controls['dimension'].value || -1,
        this.updateColumn.controls['cardinality'].value || -1
    );
    if (!this._types.supportsPrecision(newColumn.dataType) && newColumn.precision !== null) {
      newColumn.precision = null;
    }
    if (!this._types.supportsScale(newColumn.dataType) && newColumn.scale !== null) {
      newColumn.scale = null;
    }
    const req = new ColumnRequest(this.entity.value.id, oldColumn, newColumn);
    this._crud.updateColumn(req).subscribe({
      next: (res: RelationalResult) => {
        this.editColumn = -1;
        this._catalog.updateIfNecessary();
        if (res.error) {
          this._toast.exception(res, 'Could not update column:');
          console.log(res);
        } else {
          this._toast.success('The new column was saved.', res.query, 'column saved');
        }
      }, error: err => {
        this._toast.error('Could not save column due to an error on the server.', null, ToastDuration.INFINITE);
        console.log(err);
      }
    });
  }

  addColumn() {
    if (this.createColumn.name === '') {
      this._toast.warn('Please provide a name for the new column.', 'missing column name');
      return;
    }
    if (!this._crud.nameIsValid(this.createColumn.name)) {
      this._toast.warn(this._crud.invalidNameMessage('column'), 'invalid column name');
      return;
    }
    if (Array.from(this.oldColumns.value.values()).filter((h) => h.name === this.createColumn.name).length > 0) {
      this._toast.warn('There already exists a column with this name', 'invalid column name');
      return;
    }
    if (!this._types.supportsPrecision(this.createColumn.dataType) && this.createColumn.precision !== null) {
      this.createColumn.precision = null;
    }
    if (!this._types.supportsScale(this.createColumn.dataType) && this.createColumn.scale !== null) {
      this.createColumn.scale = null;
    }
    const req = new ColumnRequest(this.entity.value.id, null, this.createColumn);
    this._crud.addColumn(req).subscribe({
      next: (res: RelationalResult) => {
        if (res.error === undefined) {
          this._catalog.updateIfNecessary();
          this.createColumn.name = '';
          this.createColumn.nullable = true;
          this.createColumn.dataType = INITIAL_TYPE;
          this.createColumn.collectionsType = '';
          this.createColumn.precision = null;
          this.createColumn.scale = null;
          this.createColumn.defaultValue = null;
        } else {
          this._toast.exception(res, null, 'server error', ToastDuration.INFINITE);
        }
      }, error: err => {
        this._toast.error('An error occurred on the server.', null, ToastDuration.INFINITE);
        console.log(err);
      }
    });
  }

  dropColumn(col: UiColumnDefinition) {
    this._crud.dropColumn(new ColumnRequest(this.entity.value.id, col)).subscribe(
        (result: RelationalResult) => {
          this._catalog.updateIfNecessary();
          //this.getPlacementsAndPartitions();
          this.confirm = -1;
          if (result.error) {
            this._toast.exception(result, 'Could not delete column:', 'server error', ToastDuration.INFINITE);
          }
        }, err => {
          this._toast.error('Could not delete column.', null, ToastDuration.INFINITE);
          console.log(err);
        }
    );
  }

  getUml() {
    this.foreignKeys = [];
    if (!this.namespace) {
      this.foreignKeys = null;
      return;
    }
    this._crud.getUml(new EditTableRequest(this.namespace.value.id)).subscribe({
      next: (uml: Uml) => {

        const fks = new Map<string, ForeignKey>();

        uml.foreignKeys.forEach((v, k) => {
          if ((v.sourceSchema + '.' + v.sourceTable) === this._catalog.getFullEntityName(this.entity.value.id).value) {
            if (fks.has(v.fkName)) {
              const fk = fks.get(v.fkName);
              fk.targetColumn = fk.targetColumn + ', ' + v.targetColumn;
              fk.sourceColumn = fk.sourceColumn + ', ' + v.sourceColumn;
            } else {
              fks.set(v.fkName, v);
            }
            this.foreignKeys = [...fks.values()];
          }
        });
      }, error: err => {
        console.log(err);
      }
    });
  }


  dropConstraint(constraintId: number) {
    this._crud.dropConstraint(new ConstraintRequest(this.entity.value.id, new TableConstraint(constraintId))).subscribe({
      next: (result: RelationalResult) => {
        if (result.error) {
          this._toast.exception(result, null, 'constraint error');
        } else {
          this._catalog.updateIfNecessary();
          this.getUml();
        }
      }, error: err => {
        console.log(err);
      }
    });
  }

  updatePrimaryKey() {
    const pk = new TableConstraint(-1, 'PRIMARY KEY');
    this.newPrimaryKey.forEach((v, k) => {
      if (v.primary) {
        pk.addColumn(v.name);
      }
    });
    const constraintRequest = new ConstraintRequest(this.entity.value.id, pk);
    this._crud.addPrimaryKey(constraintRequest).subscribe({
      next: (res: RelationalResult) => {
        if (!res.error) {
          this._toast.success('The primary key was updated.', res.query, 'updated primary key');
          this._catalog.updateIfNecessary();
          //this.getPlacementsAndPartitions();
        } else {
          this._toast.exception(res, null, 'primary key error', ToastDuration.INFINITE);
        }
      }, error: err => {
        this._toast.error('Could not update primary key.', null, ToastDuration.INFINITE);
        console.log(err);
      }
    });
  }

  addUniqueConstraint() {
    if (this.uniqueConstraintName === '') {
      if (!this.proposedConstraintName) {
        this._toast.warn('Please provide a name for the unique constraint.', 'constraint name');
        return;
      } else {
        this.uniqueConstraintName = this.proposedConstraintName;
      }
    }
    if (!this._crud.nameIsValid(this.uniqueConstraintName)) {
      this._toast.warn(this._crud.invalidNameMessage('unique constraint'), 'invalid constraint name');
      return;
    }
    const constraint = new TableConstraint(-1, this.uniqueConstraintName, 'UNIQUE');
    let counter = 0;
    this.oldColumns.value.forEach((v, k) => {
      if (v.unique) {
        constraint.addColumn(v.name);
        counter++;
      }
    });
    if (counter === 0) {
      this._toast.warn('Please select at least one column that should be part of the unique constraint.', 'unique constraint');
      return;
    }
    const constraintRequest = new ConstraintRequest(this.entity.value.id, constraint);
    this._crud.addUniqueConstraint(constraintRequest).subscribe({
      next: (res: RelationalResult) => {
        if (!res.error) {
          this._catalog.updateIfNecessary();
          this._toast.success('The unique constraint was successfully created', res.query, 'added constraint');
          this.uniqueConstraintName = '';
          this.getGeneratedNames();
          this.oldColumns.value.forEach((v, k) => {
            v.unique = false;
          });
        } else {
          this._toast.exception(res, null, 'unique constraint error', ToastDuration.INFINITE);
        }
      }, error: err => {
        this._toast.error('Could not add unique constraint.', null, ToastDuration.INFINITE);
        console.log(err);
      }
    });
  }

  assignDefault(col: any, isFormGroup: boolean) {
    if (isFormGroup) {
      if (this._types.isNumeric(col.controls['dataType'].value)) {
        col.controls['defaultValue'].setValue(0);
      } else if (this._types.isBoolean(col.controls['dataType'].value)) {
        col.controls['defaultValue'].setValue(false);
      } else {
        col.controls['defaultValue'].setValue('');
      }
    } else {
      if (this._types.isNumeric(col.dataType)) {
        col.defaultValue = 0;
      } else if (this._types.isBoolean(col.dataType)) {
        col.defaultValue = false;
      } else {
        col.defaultValue = '';
      }
    }
  }

  triggerDefaultNull(col: UiColumnDefinition = null) {
    if (col === null) {//when updating a column
      if (this.updateColumn.controls['defaultValue'].value === null) {
        this.updateColumn.controls['defaultValue'].enable();
        this.assignDefault(this.updateColumn, true);
      } else {
        this.updateColumn.controls['defaultValue'].setValue(null);
        this.updateColumn.controls['defaultValue'].disable();
      }
    } else {//if col !== null: when inserting a new column
      if (col.defaultValue === null) {
        this.assignDefault(col, false);
      } else {
        col.defaultValue = null;
      }
    }
  }

  changeNullable(col: UiColumnDefinition = null) {
    if (col === null) {//when updating a column
      if (this.updateColumn.controls['defaultValue'].value === null && this.updateColumn.controls['nullable'].value === false) {
        this.updateColumn.controls['defaultValue'].enable();
        this.assignDefault(this.updateColumn, true);
      }
    } else {//if col !== null: when inserting a new column
      if (col.defaultValue === null && col.nullable === false) {
        this.assignDefault(col, false);
      }
    }
  }

  subscribeIndexes() {
    const sub = combineLatest([this.namespace, this.entity]).pipe(mergeMap(pair => this._crud.getIndexes(new EditTableRequest(pair[0].id, pair[1].id)))).subscribe({
      next: (res: RelationalResult) => {
        this.indexes = res;
      }, error: err => {
        console.log(err);
      }
    });
    this.subscriptions.add(sub);
  }


  initNewIndexValues() {
    const availableStores = this.availableStoresForIndexes;
    if (availableStores.value?.length > 0) {
      this.selectedStoreForIndex = availableStores[0];
      if (availableStores[0].availableIndexMethods && availableStores[0].availableIndexMethods.length > 0) {
        this.newIndexForm.controls['method'].setValue(availableStores[0].availableIndexMethods[0].name);
      }
    } else {
      this.selectedStoreForIndex = null;
      this.newIndexForm.controls['method'].setValue('');
    }
  }

  onSelectingIndexStore(store: StoreModel) {
    this.selectedStoreForIndex = store;
    this.newIndexForm.controls['method'].setValue(store.availableIndexMethods[0].name);
  }

  getAvailableStoresForIndexes() {
    this.entity.pipe(
        map(e => !!e),
        mergeMap(e =>
            this._catalog.getAvailableStoresForIndexes(this.entity.value.id))).subscribe({
      next: (stores: StoreModel[]) => {
        this.availableStoresForIndexes.next(stores);
        if (stores?.length > 0) {
          this.selectedStoreForIndex = this.availableStoresForIndexes[0];
          this.newIndexForm.controls['method'].setValue(this.selectedStoreForIndex.availableIndexMethods[0].name);
        } else {
          this.selectedStoreForIndex = null;
        }
      }, error: err => {
        console.log(err);
        this.availableStoresForIndexes = null;
        this.selectedStoreForIndex = null;
      }
    });

  }

  getAddableStores(): Observable<StoreModel[]> {
    return forkJoin([
      this.stores,
      this.placements.pipe(map(placements => placements.map(p => p.adapterId)))])
    .pipe(map(usedUnusedIds => {
      return Array.from(usedUnusedIds[0]).filter(store => usedUnusedIds[1].includes(store.id));
    }));
  }

  /*getPlacementsAndPartitions() {
      this._crud.getDataPlacements(this.namespace.value.id, this.entity.value.id).subscribe(
          res => {
              this.placements = <Placements>res;
              for (const s of this.placements.stores) {
                  s.columnPlacements.sort((a, b) => a.columnId - b.columnId);
              }

              if (this.isEntityType(EntityType.MATERIALIZED_VIEW)) {
                  this.getMaterializedInfo();
              }

              this.getIndexes();
              this.initNewIndexValues();
              if (this.placements.exception) {
                  // @ts-ignore
                  this._toast.exception({
                      error: this.placements.exception.detailMessage,
                      exception: this.placements.exception
                  });
              }
          }, err => {
              console.log(err);
          }
      );
  }*/

  initPlacementModal(method: Method, placement: AllocationPlacementModel) {
    let store;
    const preselect = this._catalog.getAllocColumns(placement.id).value;
    this.placementMethod = method;
    if (placement != null) {
      store = <StoreModel>this._catalog.getAdapter(placement.adapterId).value;
      this.selectedStore = store;
    }
    if (!this.selectedStore) {
      return;
    }
    this.columnPlacement = new UntypedFormGroup({});
    this.oldColumns.value.forEach((v, k) => {
      let state = true;
      if (preselect.length > 0 && !preselect.some(e => e.name === v.name && e.placementType === PlacementType.MANUAL)) {
        state = false;
      }
      this.columnPlacement.addControl(v.name, new UntypedFormControl(state));
    });
    this.placementModal = true;
  }

  clearPlacementModal() {
    this.selectedStore = null;
  }

  selectAllColumns(selectAll: boolean) {
    this.oldColumns.value.forEach((v, k) => {
      this.columnPlacement.get(v.name).setValue(selectAll);
    });
  }

  addPlacement() {
    const cols = [];
    for (const [k, v] of Object.entries(this.columnPlacement.value)) {
      //const v = this.columnPlacement.value[k];
      if (v) {
        cols.push(k);
      }
    }
    this.isAddingPlacement = true;
    this._crud.addDropPlacement(this.namespace.value.id, this.entity.value.id, this.selectedStore.id, this.placementMethod, cols).subscribe({
      next: (res: RelationalResult) => {
        if (res.error) {
          this._toast.exception(res);
        } else {
          if (this.placementMethod === 'ADD') {
            this._toast.success('Added placement on store ' + this.selectedStore.name, res.query, 'Added placement');
          } else if (this.placementMethod === 'MODIFY') {
            this._toast.success('Modified placement on store ' + this.selectedStore.name, res.query, 'Modified placement');
          }
          //this.getPlacementsAndPartitions();
          this.getAvailableStoresForIndexes();
        }
        this.selectedStore = null;
      }, error: err => {
        this._toast.error('Could not ' + this.placementMethod.toLowerCase() + ' placement on store ' + this.selectedStore.name);
      }
    }).add(() => {
      this.isAddingPlacement = false;
      this.placementModal = false;
    });
  }

  dropPlacement(adapterId: number) {
    const store = <StoreModel>this._catalog.getAdapter(adapterId).value;
    this._crud.addDropPlacement(this.namespace.value.id, this.entity.value.id, store.id, Method.DROP).subscribe({
      next: (res: RelationalResult) => {
        if (res.error) {
          this._toast.exception(res);
        } else {
          this._toast.success('Dropped placement on store ' + store.name, res.query, 'Dropped placement');
          //this.getPlacementsAndPartitions();
          this.getAvailableStoresForIndexes();
        }
      }, error: err => {
        this._toast.error('Could not drop placement on store ' + store.name, 'Error');
      }
    });
  }

  getPartitionTypes() {
    this._crud.getPartitionTypes().subscribe({
      next: (res: string[]) => {
        this.partitionTypes = res;
      },
      error: err => {
        console.log(err);
      }
    });
  }

  /**
   * Whether the table is partitioned
   */
  isPartitioned() {
    return this.placements.pipe(map(p => p.length > 1));
  }

  getPartitionFunctionModel() {
    if (this.partitioningRequest.method === 'NONE') {
      this._toast.warn('Please select a partitioning method.');
      return;
    }
    this.partitioningRequest.schemaName = this.namespace.value.name;
    this.partitioningRequest.tableName = this.entity.value.name;
    this._crud.getPartitionFunctionModel(this.partitioningRequest).subscribe({
      next: (res: PartitionFunctionModel) => {
        this.partitionFunctionParams = res;
        if (this.partitionFunctionParams.error) {
          this._toast.warn(this.partitionFunctionParams.error);
        } else {
          this.partitionFunctionModal = true;
        }
      }, error: err => {
        this.partitionFunctionParams = null;
        this._toast.error('Could not get partitionFunctionParams');
        console.log(err);
      }
    });
  }

  /**
   * Horizontally partition a table
   */
  partitionTable() {
    this._crud.partitionTable(this.partitionFunctionParams).subscribe({
      next: (res: RelationalResult) => {
        if (res.error) {
          this._toast.exception(res);
          console.log(res.query);
        } else {
          this._toast.success('Partitioned table', res.query);
          //this.getPlacementsAndPartitions();
        }
        this.partitionFunctionModal = false;
      }, error: err => {
        this._toast.error(err);
      }
    });
  }

  mergePartitions() {
    //const split = this.tableId.split('\.');
    const request = new PartitioningRequest(this.namespace.value.name, this.entity.value.name);
    this.isMergingPartitions = true;
    this._crud.mergePartitions(request).subscribe({
      next: res => {
        const result = <RelationalResult>res;
        if (!result.error) {
          this._toast.success('Merged partitions ');
          //this.getPlacementsAndPartitions();
        } else {
          this._toast.exception(result);
        }
      }, error: err => {
        this._toast.error('Could not merge partitions');
        console.log(err);
      }
    }).add(() => {
      this.isMergingPartitions = false;
    });
  }

  modifyPartitioning() {
    const partitions = [];
    for (let i = 0; i < this.partitionsToModify.length; i++) {
      if (this.partitionsToModify[i].selected) {
        partitions.push(this.partitionsToModify[i].partitionName);
      }
    }
    //const split = this.tableId.split('\.');
    const request = new ModifyPartitionRequest(this.namespace.value.name, this.entity.value.name, partitions, this.selectedStore.name);
    this._crud.modifyPartitions(request).subscribe({
      next: (res: RelationalResult) => {
        if (!res.error) {
          this.partitioningModal = false;
          this._toast.success('Modified partitions');
          //this.getPlacementsAndPartitions();
          console.log(res.query);
        } else {
          this._toast.exception(res);
          console.log(res.query);
        }
      }, error: err => {
        this._toast.error('Could not modify the partitioning');
      }
    });
  }

  initPartitioningModal(adapterId: number) {
    const store = <StoreModel>this._catalog.getAdapter(adapterId).value;
    this.partitionsToModify = [];
    for (const [i, partition] of this.partitions.value.entries()) {
      /*this.partitionsToModify.push({
        partitionName: partition.name,
        selected: store.partitionKeys.includes(i)
      });*/
    }

    this.selectedStore = store;
    this.partitioningModal = true;
  }

  clearPartitioningModal() {
    this.selectedStore = null;
  }

  selectAllPartitions(select: boolean) {
    for (const p of this.partitionsToModify) {
      p.selected = select;
    }
  }

  dropIndex(index: string) {
    this._crud.dropIndex(new IndexModel(this.namespace.value.id, this.entity.value.id, index, null, null, null)).subscribe({
      next: (res: RelationalResult) => {
        if (!res.error) {
          this._catalog.updateIfNecessary();
        } else {
          this._toast.exception(res, 'Could not drop index:');
        }
      }, error: err => {
        console.log(err);
      }
    });
  }

  addIndex() {
    this.indexSubmitted = true;
    const newCols = [];
    for (const [k, v] of Object.entries(this.newIndexCols)) {
      if (v) {
        newCols.push(k);
      }
    }
    if (this.newIndexForm.controls['method'].valid && this.newIndexForm.controls['name'].errors && newCols.length > 0) {
      this.newIndexForm.controls['name'].setValue(this.proposedIndexName);
    }
    if (this.newIndexForm.valid && newCols.length > 0 && this.selectedStoreForIndex != null) {
      const i = this.newIndexForm.value;
      const index = new IndexModel(this.namespace.value.id, this.entity.value.id, i.name, this.selectedStoreForIndex.name, i.method, newCols);
      this.addingIndex = true;
      this._crud.createIndex(index).subscribe({
        next: (res: RelationalResult) => {
          if (!res.error) {
            this._catalog.updateIfNecessary();
            this.getGeneratedNames();
            this.newIndexForm.reset({name: '', method: ''});
            this.initNewIndexValues();
            this.newIndexCols = new Map(Array.from(this.oldColumns.value.values()).map(c => [c.name, false]));
            this.indexSubmitted = false;
          } else {
            this._toast.exception(res, 'Could not create index:');
          }
        }, error: err => {
          console.log(err);
        }
      }).add(() => this.addingIndex = false);
    }
  }

  getGeneratedNames() {
    this._crud.getGeneratedNames().subscribe({
      next: (names: RelationalResult) => {
        if (names != null && !names.error) {
          this.proposedConstraintName = names.data[0][0];
          this.proposedIndexName = names.data[0][2];
        }
      }, error: err => {
        console.log(err);
      }
    });
  }

  inputValidation(key) {
    if (this.newIndexForm.controls[key].value === '') {
      return '';
    } else if (this.newIndexForm.controls[key].valid) {
      return {'is-valid': true};
    } else {
      return {'is-invalid': true};
    }
  }

  onTypeChange() {
    this.updateColumn.controls['defaultValue'].setValue(null);
  }

  onTypeChange2(col: UiColumnDefinition) {
    if (col.defaultValue !== null) {
      this.assignDefault(col, false);
    }
    col.precision = null;
    col.scale = null;
  }

  validate(defaultValue) {
    if (defaultValue === null) {
      return '';
    } else if (isNaN(defaultValue) || defaultValue === '') {
      return 'is-invalid';
    } else {
      return 'is-valid';
    }
  }

  validatePartitionModification() {
    if (this.partitionsToModify) {
      for (const p of this.partitionsToModify) {
        if (p.selected) {
          return true;
        }
      }
    }
    return false;
  }

  getOrNull(index: number) {
    return this.materializedInfo.pipe(map(i => {
      return i[index] || null;
    }));
  }

  getColumnsOfKey(constraint: ConstraintModel): Observable<number[]> {
    return this._catalog.getKey(constraint.keyId).pipe(map(c => c.columnIds));

  }

  getArray(values: IterableIterator<UiColumnDefinition>) {
    return Array.from(values);
  }
}
