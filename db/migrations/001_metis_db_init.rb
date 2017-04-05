Sequel.migration do

  up do

    extension(:constraint_validations)
    create_constraint_validations_table

    create_table(:files) do

      primary_key :id

      String :group_name, :null=> false
      String :project_name, :null=> false
      String :file_name, :null=> false
      String :original_name, :null=> false
      String :upload_by, :null=> false

      DateTime :start_upload, :null=> false
      DateTime :finish_upload

      Integer :file_size, :null=> false
      String :hashing_algorithm, :null=> false
      String :hash
    end

    create_table(:uploads) do

      primary_key :id
      foreign_key :file_id, :files, :null=> false, :unique=>true

      String :status, :null=> false
      Integer :current_byte_position, :null=> false
      Integer :current_blob_size, :null=> false
      Integer :next_blob_size, :null=> false
      String :next_blob_hash, :null=> false
    end
  end

  down do

    extension(:constraint_validations)

    drop_table(:uploads)
    drop_table(:files)
  end
end

# sudo -i -u developer sequel -m /var/www/metis/db/migrations postgres://developer:bc5d4fd256c6e82e2e1b5736210410fc@localhost/metis?search_path=private