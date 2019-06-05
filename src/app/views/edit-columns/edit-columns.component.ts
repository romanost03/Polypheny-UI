import { Component, OnInit } from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import * as $ from 'jquery';
import {LeftSidebarService, SidebarNode} from '../../components/left-sidebar/left-sidebar.service';
import {ColumnRequest, CrudService, SchemaRequest, DbColumn} from '../../services/crud.service';
import {ResultSet} from '../../components/data-table/models/result-set.model';
import {ToastService} from '../../components/toast/toast.service';

@Component({
  selector: 'app-edit-columns',
  templateUrl: './edit-columns.component.html',
  styleUrls: ['./edit-columns.component.scss']
})

export class EditColumnsComponent implements OnInit {

  tableId: string;
  resultSet: ResultSet;
  types: string[] = ['int8', 'int4', 'varchar', 'timestamptz', 'bool', 'text'];
  editColumn = -1;
  createColumn = { name: '', nullable: false, type:'text', maxLength: null};
  confirm = -1;


  constructor(
    private _route: ActivatedRoute,
    private _leftSidebar: LeftSidebarService,
    private _crud: CrudService,
    private _toast: ToastService
  ) { }

  ngOnInit() {

    this.getTableId();

    this.getSchema();

    this.getColumns();

    this.documentListener();
  }

  getTableId () {
    this.tableId = this._route.snapshot.paramMap.get('id');
    this._route.params.subscribe((params) => {
      this.tableId = params['id'];
      this.getColumns();
    });
  }

  getSchema () {
    this._crud.getSchema(  new SchemaRequest('/views/edit-columns/', false) ).subscribe(
      res => {
        const schema = <SidebarNode[]> res;
        this._leftSidebar.setNodes( schema );
      }, err => {
        this._toast.toast( 'server error', 'Could not load database schema.', 0, 'bg-danger' );
        console.log(err);
      }
    );
    this._leftSidebar.open();
  }

  getColumns () {
    if( this.tableId === undefined ) return;
    this._crud.getColumns( new ColumnRequest( this.tableId )).subscribe(
      res => {
        this.resultSet = <ResultSet> res;
      }, err => {
        this._toast.toast( 'server error', 'Could not load columns of the table.', 0, 'bg-danger' );
        console.log(err);
      }
    );
  }

  editCol( i:number ) {
    this.editColumn = i;
  }
  
  saveCol() {
    const oldColName = $('#colName').attr('data-before');
    const newColName = $('#colName').val();
    const oldNullable = $('#nullable').attr('data-before') === 'YES';
    const newNullable = $('#nullable').is(':checked');
    const oldType = $('#udt_name').attr('data-before');
    const newType = $('#udt_name').val();
    let oldMaxLength = $('#max-length').attr('data-before');
    if( oldMaxLength === undefined ) oldMaxLength = '';
    const newMaxLength = $('#max-length').val();

    const oldColumn = new DbColumn( oldColName, oldNullable, oldType, oldMaxLength );
    const newColumn = new DbColumn( newColName, newNullable, newType, newMaxLength );
    const req = new ColumnRequest( this.tableId, oldColumn, newColumn );
    console.log(req);
    this._crud.updateColumn( req ).subscribe(
      res => {
        console.log(res);
        const result = <ResultSet> res;
        this.editColumn = -1;
        this.getColumns();
        if( result.error ){
          this._toast.toast( 'error', 'Could not update column: '+result.error, 0, 'bg-warning' );
        }else{
          this._toast.toast( 'column saved', 'The new column was saved.', 10, 'bg-success' );
        }
      }, err => {
        this._toast.toast( 'server error', 'Could not save column due to an error on the server.', 0, 'bg-danger' );
        console.log(err);
      }
    );
  }

  addColumn() {
    if( this.createColumn.name === ''){
      this._toast.toast( 'missing column name', 'Please provide a name for the new column.', 0, 'bg-warning');
      return;
    }
    const newColumn = new DbColumn( this.createColumn.name, this.createColumn.nullable, this.createColumn.type, this.createColumn.maxLength );
    const req = new ColumnRequest( this.tableId, null, newColumn );
    console.log(req);
    this._crud.addColumn( req ).subscribe(
      res => {
        const result = <ResultSet> res;
        if( result.error === undefined ){
          this.getColumns();
          this.createColumn.name = '';
          this.createColumn.nullable = false;
          this.createColumn.type = this.types[0];
          this.createColumn.maxLength = null;
        } else {
          this._toast.toast( 'server error', result.error, 0, 'bg-warning' );
        }
      }, err => {
        this._toast.toast( 'server error', 'An error occured on the server.', 0, 'bg-danger' );
        console.log(err);
    }
    );
  }
  
  dropColumn ( col, i ) {
    if ( this.confirm !== i ){
      this.confirm = i;
    } else {
      this._crud.dropColumn( new ColumnRequest( this.tableId, new DbColumn( col[0], col[1], col[2], col[3] ) ) ).subscribe(
        res => {
          console.log(res);
          this.getColumns();
          this.confirm = -1;
        }, err => {
          this._toast.toast( 'server error', 'Could not delete column.', 0, 'bg-danger' );
          console.log(err);
        }
      );
    }
  }

  documentListener() {
    const self = this;
    $(document).on('click', function(e){
      if(!$(e.target).hasClass('editing')){
        self.editColumn = -1;
      }
    });
  }

}
